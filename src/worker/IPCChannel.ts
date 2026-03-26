import { MessagePort, Worker } from 'worker_threads';

export interface IPCRequest {
  kind: 'request';
  id: string;
  type: string;
  args: any[];
}

export interface IPCResponse {
  kind: 'response';
  id: string;
  result?: any;
  error?: string;
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
};

export class IPCChannel {
  private port: MessagePort | Worker;
  private pending = new Map<string, PendingRequest>();
  private requestHandler: ((type: string, args: any[]) => Promise<any>) | null = null;
  private notifyHandler: ((type: string, data: any) => void) | null = null;
  private commandHandler: ((type: string, data: any) => void) | null = null;
  private idCounter = 0;

  constructor(port: MessagePort | Worker) {
    this.port = port;
    port.on('message', (msg: IPCMessage) => this.handleMessage(msg));
  }

  /** Send a request and wait for a response (worker → main or main → worker) */
  request(type: string, args: any[], timeoutMs = 60000): Promise<any> {
    const id = `req_${++this.idCounter}_${Date.now().toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC request '${type}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.port.postMessage({ kind: 'request', id, type, args } as IPCRequest);
    });
  }

  /** Fire-and-forget notification */
  notify(type: string, data: any): void {
    this.port.postMessage({ kind: 'notify', type, data } as IPCNotification);
  }

  /** Send a command (main → worker) */
  command(type: string, data: any): void {
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

  destroy(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error('IPC channel destroyed'));
    }
    this.pending.clear();
  }

  private async handleMessage(msg: IPCMessage): Promise<void> {
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
      this.port.postMessage({ kind: 'response', id: msg.id, error: 'No request handler registered' } as IPCResponse);
      return;
    }
    try {
      const result = await this.requestHandler(msg.type, msg.args);
      this.port.postMessage({ kind: 'response', id: msg.id, result } as IPCResponse);
    } catch (err: any) {
      this.port.postMessage({ kind: 'response', id: msg.id, error: err.message || String(err) } as IPCResponse);
    }
  }

  private handleResponse(msg: IPCResponse): void {
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    clearTimeout(pending.timer);
    if (msg.error) {
      pending.reject(new Error(msg.error));
    } else {
      pending.resolve(msg.result);
    }
  }
}
