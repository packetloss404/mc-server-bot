/**
 * CommandCenter — dispatches commands to bots and tracks their lifecycle.
 * Stub: real implementation will replace this file.
 */

export type CommandType =
  | 'pause_voyager'
  | 'resume_voyager'
  | 'stop_movement'
  | 'goto'
  | 'chat'
  | 'custom';

export type CommandStatus = 'queued' | 'started' | 'succeeded' | 'failed' | 'cancelled';

export interface CommandRecord {
  id: string;
  botName: string;
  type: CommandType;
  payload: Record<string, unknown>;
  status: CommandStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

let idCounter = 0;

export class CommandCenter {
  private commands: Map<string, CommandRecord> = new Map();
  private io: { emit: (...args: any[]) => void } | null;
  private botManager: any;

  constructor(botManager: any, io?: any) {
    this.botManager = botManager;
    this.io = io ?? null;
  }

  createCommand(botName: string, type: CommandType, payload: Record<string, unknown> = {}): CommandRecord {
    const bot = this.botManager.getBot(botName);
    const now = Date.now();
    const id = `cmd-${++idCounter}-${now}`;
    const record: CommandRecord = {
      id,
      botName,
      type,
      payload,
      status: bot ? 'queued' : 'failed',
      createdAt: now,
      updatedAt: now,
      error: bot ? undefined : `Bot '${botName}' not found`,
    };
    this.commands.set(id, record);
    if (record.status === 'queued') {
      this.emitEvent('command:queued', record);
    }
    return record;
  }

  async dispatch(id: string): Promise<CommandRecord> {
    const record = this.commands.get(id);
    if (!record) throw new Error(`Command ${id} not found`);
    if (record.status !== 'queued') return record;

    this.setStatus(record, 'started');

    try {
      const instance = this.botManager.getBot(record.botName);
      if (!instance) throw new Error(`Bot '${record.botName}' not found`);

      switch (record.type) {
        case 'pause_voyager': {
          const voyager = instance.getVoyagerLoop();
          voyager.pause();
          break;
        }
        case 'resume_voyager': {
          const voyager = instance.getVoyagerLoop();
          voyager.resume();
          break;
        }
        case 'stop_movement': {
          instance.bot.pathfinder.stop();
          break;
        }
        default:
          break;
      }

      this.setStatus(record, 'succeeded');
    } catch (err: any) {
      record.error = err.message ?? String(err);
      this.setStatus(record, 'failed');
    }

    return record;
  }

  cancel(id: string): CommandRecord {
    const record = this.commands.get(id);
    if (!record) throw new Error(`Command ${id} not found`);
    if (record.status === 'queued') {
      this.setStatus(record, 'cancelled');
    }
    return record;
  }

  getCommands(botName?: string): CommandRecord[] {
    const all = Array.from(this.commands.values());
    return botName ? all.filter((c) => c.botName === botName) : all;
  }

  getCommand(id: string): CommandRecord | undefined {
    return this.commands.get(id);
  }

  private setStatus(record: CommandRecord, status: CommandStatus): void {
    record.status = status;
    record.updatedAt = Date.now();
    this.emitEvent(`command:${status}`, record);
  }

  private emitEvent(event: string, record: CommandRecord): void {
    if (this.io) {
      this.io.emit(event, record);
    }
  }
}
