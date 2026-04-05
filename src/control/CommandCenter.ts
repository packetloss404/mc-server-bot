/* ── CommandCenter: immediate command dispatch with timeout & cancellation ── */

import { randomUUID } from 'crypto';
import {
  Command,
  CommandPayload,
  CommandResult,
  CommandType,
} from './CommandTypes';
import { MissionManager } from './MissionManager';
import { RoleManager } from './RoleManager';

export type CommandDispatcher = (botName: string, command: Command) => Promise<CommandResult>;

export class CommandCenter {
  private commands: Map<string, Command> = new Map();
  private dispatcher: CommandDispatcher | null = null;
  private missionManager: MissionManager | null = null;
  private roleManager: RoleManager | null = null;
  private timers: Map<string, NodeJS.Timeout> = new Map();

  setDispatcher(fn: CommandDispatcher): void {
    this.dispatcher = fn;
  }

  setMissionManager(mm: MissionManager): void {
    this.missionManager = mm;
  }

  setRoleManager(rm: RoleManager): void {
    this.roleManager = rm;
  }

  /** Create and dispatch a command. Returns the command ID. */
  async dispatch(
    type: CommandType,
    botName: string,
    payload: CommandPayload,
    source: string,
    timeoutMs = 30_000
  ): Promise<Command> {
    const id = randomUUID();
    const now = Date.now();

    const cmd: Command = {
      id,
      type,
      botName,
      payload,
      status: 'pending',
      source,
      createdAt: now,
      updatedAt: now,
      timeoutMs,
    };

    // ── Interrupt-policy check ──
    if (this.missionManager) {
      const activeMission = this.missionManager.getActiveMissionForBot(botName);
      if (activeMission && activeMission.priority === 'critical') {
        cmd.status = 'rejected';
        cmd.error = 'Bot has a critical mission in progress';
        cmd.updatedAt = Date.now();
        this.commands.set(id, cmd);
        return cmd;
      }
    }

    this.commands.set(id, cmd);

    // ── Dispatch ──
    if (this.dispatcher) {
      cmd.status = 'dispatched';
      cmd.updatedAt = Date.now();

      // Start timeout timer
      if (timeoutMs > 0) {
        const timer = setTimeout(() => {
          if (cmd.status === 'dispatched' || cmd.status === 'running') {
            cmd.status = 'timed_out';
            cmd.updatedAt = Date.now();
          }
          this.timers.delete(id);
        }, timeoutMs);
        this.timers.set(id, timer);
      }

      try {
        const result = await this.dispatcher(botName, cmd);
        if (result.success) {
          cmd.status = 'completed';
        } else {
          cmd.status = 'failed';
          cmd.error = result.error;
        }
      } catch (err: any) {
        cmd.status = 'failed';
        cmd.error = err.message || 'dispatch error';
      }

      cmd.updatedAt = Date.now();
      this.clearTimer(id);
    }

    return cmd;
  }

  /** Fan-out: dispatch the same command to multiple bots */
  async fanOut(
    type: CommandType,
    botNames: string[],
    payload: CommandPayload,
    source: string,
    timeoutMs = 30_000
  ): Promise<Command[]> {
    return Promise.all(
      botNames.map((name) => this.dispatch(type, name, payload, source, timeoutMs))
    );
  }

  cancel(commandId: string): boolean {
    const cmd = this.commands.get(commandId);
    if (!cmd) return false;
    if (cmd.status === 'completed' || cmd.status === 'cancelled' || cmd.status === 'failed') {
      return false;
    }
    cmd.status = 'cancelled';
    cmd.updatedAt = Date.now();
    this.clearTimer(commandId);
    return true;
  }

  get(commandId: string): Command | undefined {
    return this.commands.get(commandId);
  }

  list(): Command[] {
    return [...this.commands.values()];
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  /** Persist commands to a plain object (for JSON serialization) */
  toJSON(): Command[] {
    return this.list();
  }

  /** Restore commands from persisted data */
  loadFrom(commands: Command[]): void {
    this.commands.clear();
    for (const cmd of commands) {
      this.commands.set(cmd.id, cmd);
    }
  }
}
