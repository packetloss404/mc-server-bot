/**
 * DecisionTrace — structured log of every decision a bot makes during the
 * VoyagerLoop.  Each entry captures *what* was decided, *why*, and the
 * alternatives that were considered.
 *
 * Lives in-worker (where decisions happen) and forwards entries to the main
 * thread via IPC so the dashboard can query them.
 */

// ── Trace record types ──────────────────────────────────────────────

export type TraceType =
  | 'task_selection'
  | 'skill_vs_codegen'
  | 'code_generation'
  | 'execution'
  | 'critic_evaluation'
  | 'retry_decision'
  | 'task_outcome';

export interface TraceCandidate {
  label: string;
  chosen: boolean;
  reason?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface TraceRecord {
  id: string;
  type: TraceType;
  botName: string;
  task: string;
  timestamp: number;
  /** Human-readable summary of the decision */
  summary: string;
  /** What was chosen */
  decision: string;
  /** All candidates that were considered (including the chosen one) */
  candidates?: TraceCandidate[];
  /** Arbitrary structured data specific to this trace type */
  details: Record<string, unknown>;
}

// ── Circular buffer ─────────────────────────────────────────────────

export class DecisionTrace {
  private buffer: TraceRecord[] = [];
  private maxSize: number;
  private seq = 0;
  private botName: string;
  private onEmit?: (record: TraceRecord) => void;

  constructor(botName: string, maxSize = 500) {
    this.botName = botName;
    this.maxSize = maxSize;
  }

  /** Register a callback that fires on every new trace (used for IPC forwarding). */
  setEmitter(fn: (record: TraceRecord) => void): void {
    this.onEmit = fn;
  }

  private onReputationEmit?: (event: any) => void;

  /** Register a callback for reputation events (used for IPC forwarding). */
  setReputationEmitter(fn: (event: any) => void): void {
    this.onReputationEmit = fn;
  }

  /** Emit a reputation event. */
  emitReputation(event: any): void {
    this.onReputationEmit?.(event);
  }

  /** Record a decision. Returns the created record. */
  record(
    type: TraceType,
    task: string,
    summary: string,
    decision: string,
    details: Record<string, unknown> = {},
    candidates?: TraceCandidate[],
  ): TraceRecord {
    const entry: TraceRecord = {
      id: `${this.botName}-${++this.seq}`,
      type,
      botName: this.botName,
      task,
      timestamp: Date.now(),
      summary,
      decision,
      candidates,
      details,
    };

    this.buffer.push(entry);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    this.onEmit?.(entry);
    return entry;
  }

  /** Query recent traces with optional filters. */
  getRecent(limit = 50, type?: TraceType): TraceRecord[] {
    let records = this.buffer;
    if (type) {
      records = records.filter((r) => r.type === type);
    }
    return records.slice(-limit).reverse(); // newest first
  }

  /** Get all traces (newest first). */
  getAll(): TraceRecord[] {
    return [...this.buffer].reverse();
  }

  /** Current buffer size. */
  get size(): number {
    return this.buffer.length;
  }
}
