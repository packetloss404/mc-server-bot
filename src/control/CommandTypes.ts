/* ── Command types for the control platform ── */

export type CommandType =
  | 'pause'
  | 'resume'
  | 'move'
  | 'follow'
  | 'guard'
  | 'patrol'
  | 'stop'
  | 'queue_task';

export type CommandStatus =
  | 'pending'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rejected'
  | 'timed_out';

export interface CommandPayload {
  /** Where to move / patrol waypoints / follow target, etc. */
  target?: { x: number; y: number; z: number };
  targetBot?: string;
  waypoints?: Array<{ x: number; y: number; z: number }>;
  taskDescription?: string;
  [key: string]: unknown;
}

export interface Command {
  id: string;
  type: CommandType;
  botName: string;
  payload: CommandPayload;
  status: CommandStatus;
  /** Who or what issued the command */
  source: string;
  createdAt: number;
  updatedAt: number;
  /** Error message when status is 'failed' or 'rejected' */
  error?: string;
  /** Timeout in ms — 0 means no timeout */
  timeoutMs: number;
}

export interface CommandResult {
  commandId: string;
  success: boolean;
  error?: string;
}

/**
 * Interrupt policy — determines whether a new command can interrupt an
 * ongoing mission on a bot.
 */
export type InterruptPolicy = 'always' | 'non_critical' | 'never';
