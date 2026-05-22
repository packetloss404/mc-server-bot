import { MessagePort, Worker } from 'worker_threads';
import { randomUUID } from 'crypto';

export interface IPCRequest {
  kind: 'request';
  id: string;
  type: string;
  args: any[];
}

/**
 * Serialized error payload. Older builds shipped only `error: string`; newer
 * builds attach a structured `errorInfo` so we can rebuild a richer Error on
 * the receiving side (preserving `name` and the worker-side `stack`). We keep
 * `error` populated as a message for backwards compatibility with any peer
 * that hasn't been rebuilt yet.
 */
export interface IPCResponse {
  kind: 'response';
  id: string;
  result?: any;
  error?: string;
  errorInfo?: { message: string; name?: string; stack?: string };
}

export interface IPCNotification {
  kind: 'notify';
  type: string;
  data: any;
}

export interface IPCCommand {
  kind: 'command';
  type: string;
  data: any;
}

export type IPCMessage = IPCRequest | IPCResponse | IPCNotification | IPCCommand;

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  type: string;
};

export class IPCChannel {
  private port: MessagePort | Worker;
  private pending = new Map<string, PendingRequest>();
  private requestHandler: ((type: string, args: any[]) => Promise<any>) | null = null;
  private notifyHandler: ((type: string, data: any) => void) | null = null;
  private commandHandler: ((type: string, data: any) => void) | null = null;
  private destroyed = false;

  constructor(port: MessagePort | Worker) {
    this.port = port;
    port.on('message', (msg: IPCMessage) => this.handleMessage(msg));
  }

  /**
   * Send a request and wait for a response (worker → main or main → worker).
   *
   * Request IDs use `crypto.randomUUID()` so two requests posted in the same
   * tick (or after a wrap-around of any counter) cannot collide, even across
   * parallel execution paths. This also closes the "late-timeout leak" where
   * a stale response could otherwise fulfil a newer request that happened to
   * reuse the same id.
   */
  request(type: string, args: any[], timeoutMs = 60000): Promise<any> {
    if (this.destroyed) {
      return Promise.reject(new Error(`IPC channel destroyed (request '${type}' not sent)`));
    }
    const id = `req_${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC request '${type}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, type });
      this.port.postMessage({ kind: 'request', id, type, args } as IPCRequest);
    });
  }

  /** Fire-and-forget notification */
  notify(type: string, data: any): void {
    if (this.destroyed) return;
    this.port.postMessage({ kind: 'notify', type, data } as IPCNotification);
  }

  /** Send a command (main → worker) */
  command(type: string, data: any): void {
    if (this.destroyed) return;
    this.port.postMessage({ kind: 'command', type, data } as IPCCommand);
  }

  /** Register handler for incoming requests (returns result or throws) */
  onRequest(handler: (type: string, args: any[]) => Promise<any>): void {
    this.requestHandler = handler;
  }

  /** Register handler for incoming notifications */
  onNotify(handler: (type: string, data: any) => void): void {
    this.notifyHandler = handler;
  }

  /** Register handler for incoming commands */
  onCommand(handler: (type: string, data: any) => void): void {
    this.commandHandler = handler;
  }

  /**
   * Tear down the channel: reject every pending request, clear timers, and
   * mark the channel as destroyed so subsequent request()/handleResponse()
   * calls fail fast instead of silently swallowing data or hanging until the
   * 60s timeout. Safe to call multiple times.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('IPC channel destroyed'));
    }
    this.pending.clear();
  }

  /** True if destroy() has been called. */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  private async handleMessage(msg: IPCMessage): Promise<void> {
    // Drop everything once destroyed — there is no pending map to serve and
    // we don't want to invoke handlers against a dead WorkerHandle.
    if (this.destroyed) return;
    switch (msg.kind) {
      case 'request':
        await this.handleRequest(msg);
        break;
      case 'response':
        this.handleResponse(msg);
        break;
      case 'notify':
        this.notifyHandler?.(msg.type, msg.data);
        break;
      case 'command':
        this.commandHandler?.(msg.type, msg.data);
        break;
    }
  }

  private async handleRequest(msg: IPCRequest): Promise<void> {
    if (!this.requestHandler) {
      this.port.postMessage({
        kind: 'response',
        id: msg.id,
        error: 'No request handler registered',
        errorInfo: { message: 'No request handler registered', name: 'Error' },
      } as IPCResponse);
      return;
    }
    try {
      const result = await this.requestHandler(msg.type, msg.args);
      this.port.postMessage({ kind: 'response', id: msg.id, result } as IPCResponse);
    } catch (err: any) {
      // Serialize stack/name in addition to message so the peer can rebuild
      // a richer Error with provenance instead of a bare `new Error(msg)`.
      const message = err?.message ?? String(err);
      const name = typeof err?.name === 'string' ? err.name : 'Error';
      const stack = typeof err?.stack === 'string' ? err.stack : undefined;
      this.port.postMessage({
        kind: 'response',
        id: msg.id,
        error: message,
        errorInfo: { message, name, stack },
      } as IPCResponse);
    }
  }

  private handleResponse(msg: IPCResponse): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.errorInfo || msg.error) {
      pending.reject(this.rebuildError(msg, pending.type));
    } else {
      pending.resolve(msg.result);
    }
  }

  /**
   * Reconstruct an Error from the wire payload. Prefers the structured
   * `errorInfo` (with name/stack) when present and falls back to the legacy
   * `error: string` field for older peers. The local Error's stack is
   * concatenated with the remote stack so debugging shows both sides of the
   * IPC boundary.
   */
  private rebuildError(msg: IPCResponse, requestType: string): Error {
    const info = msg.errorInfo ?? { message: msg.error || 'Unknown IPC error', name: 'Error' };
    const err = new Error(info.message);
    if (info.name && info.name !== 'Error') {
      err.name = info.name;
    }
    if (info.stack) {
      const localStack = err.stack ? `\n    at IPC boundary (request '${requestType}')\n${err.stack}` : '';
      err.stack = `${info.stack}${localStack}`;
    }
    return err;
  }
}
