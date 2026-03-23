import { Server as SocketIOServer } from 'socket.io';
import {
  CommandRecord,
  CommandType,
  CommandScope,
  CommandPriority,
  CommandSource,
  CommandStatus,
  CommandError,
  COMMAND_EVENTS,
} from './CommandTypes';
import { BotManager } from '../bot/BotManager';
import { BotInstance } from '../bot/BotInstance';
import { logger } from '../util/logger';
import * as fs from 'fs';
import * as path from 'path';

export interface CreateCommandParams {
  type: CommandType;
  scope?: CommandScope;
  priority?: CommandPriority;
  source?: CommandSource;
  targets: string[];
  params?: Record<string, any>;
}

interface CommandFilters {
  bot?: string;
  status?: CommandStatus;
  limit?: number;
}

const DATA_PATH = path.join(process.cwd(), 'data', 'commands.json');
const MAX_PERSISTED = 500;

export class CommandCenter {
  private commands: Map<string, CommandRecord> = new Map();
  private botManager: BotManager;
  private io: SocketIOServer;

  constructor(botManager: BotManager, io: SocketIOServer) {
    this.botManager = botManager;
    this.io = io;
    this.loadFromDisk();
  }

  // ── ID generation ──────────────────────────────────────────

  private generateId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── Public API ─────────────────────────────────────────────

  createCommand(params: CreateCommandParams): CommandRecord {
    const command: CommandRecord = {
      id: this.generateId(),
      type: params.type,
      scope: params.scope ?? 'single',
      priority: params.priority ?? 'normal',
      source: params.source ?? 'api',
      status: 'queued',
      targets: params.targets,
      params: params.params ?? {},
      createdAt: new Date().toISOString(),
    };

    this.commands.set(command.id, command);
    this.emitStatus(command, COMMAND_EVENTS.QUEUED);
    this.persist();

    logger.info(
      { commandId: command.id, type: command.type, targets: command.targets, source: command.source },
      'Command created',
    );

    return command;
  }

  async dispatchCommand(command: CommandRecord): Promise<CommandRecord> {
    // Fan-out for multi-target scopes
    if (
      (command.scope === 'squad' || command.scope === 'selection' || command.scope === 'all') &&
      command.targets.length > 1
    ) {
      return this.dispatchFanOut(command);
    }

    this.updateStatus(command, 'started');

    try {
      const botName = command.targets[0];
      if (!botName) {
        throw { code: 'NO_TARGET', message: 'No target bot specified' } as CommandError;
      }

      const bot = this.botManager.getBot(botName);
      if (!bot) {
        throw { code: 'BOT_NOT_FOUND', message: `Bot "${botName}" not found`, botName } as CommandError;
      }

      const result = await this.executeHandler(command.type, bot, command.params);
      command.result = result;
      this.updateStatus(command, 'succeeded');
    } catch (err: any) {
      const cmdError: CommandError =
        err && err.code
          ? err
          : { code: 'HANDLER_ERROR', message: String(err?.message ?? err) };
      command.error = cmdError;
      this.updateStatus(command, 'failed');
    }

    return command;
  }

  getCommands(filters?: CommandFilters): CommandRecord[] {
    let results = [...this.commands.values()];

    // Newest first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (filters?.bot) {
      results = results.filter((c) => c.targets.includes(filters.bot!));
    }
    if (filters?.status) {
      results = results.filter((c) => c.status === filters.status);
    }
    const limit = filters?.limit ?? 100;
    return results.slice(0, limit);
  }

  getCommand(id: string): CommandRecord | undefined {
    return this.commands.get(id);
  }

  cancelCommand(id: string): CommandRecord | undefined {
    const command = this.commands.get(id);
    if (!command) return undefined;

    if (command.status === 'queued' || command.status === 'started') {
      this.updateStatus(command, 'cancelled');
      return command;
    }

    // Already terminal — return as-is
    return command;
  }

  // ── Fan-out ────────────────────────────────────────────────

  private async dispatchFanOut(parent: CommandRecord): Promise<CommandRecord> {
    this.updateStatus(parent, 'started');

    const childIds: string[] = [];
    let allSucceeded = true;
    const errors: CommandError[] = [];

    for (const target of parent.targets) {
      const child = this.createCommand({
        type: parent.type,
        scope: 'single',
        priority: parent.priority,
        source: parent.source,
        targets: [target],
        params: parent.params,
      });
      child.parentCommandId = parent.id;
      childIds.push(child.id);

      await this.dispatchCommand(child);

      if (child.status !== 'succeeded') {
        allSucceeded = false;
        if (child.error) errors.push(child.error);
      }
    }

    parent.childCommandIds = childIds;

    if (allSucceeded) {
      parent.result = { childCount: childIds.length, allSucceeded: true };
      this.updateStatus(parent, 'succeeded');
    } else {
      parent.error = {
        code: 'PARTIAL_FAILURE',
        message: `${errors.length}/${parent.targets.length} targets failed`,
      };
      parent.result = { childCount: childIds.length, failedCount: errors.length, errors };
      this.updateStatus(parent, 'failed');
    }

    return parent;
  }

  // ── Command handlers ───────────────────────────────────────

  private async executeHandler(
    type: CommandType,
    bot: BotInstance,
    params: Record<string, any>,
  ): Promise<Record<string, any>> {
    switch (type) {
      case 'pause_voyager':
        return this.handlePauseVoyager(bot);
      case 'resume_voyager':
        return this.handleResumeVoyager(bot);
      case 'stop_movement':
        return this.handleStopMovement(bot);
      case 'follow_player':
        return this.handleFollowPlayer(bot, params);
      case 'walk_to_coords':
        return this.handleWalkToCoords(bot, params);
      case 'move_to_marker':
        return this.handleStub('move_to_marker — needs MarkerStore integration');
      case 'return_to_base':
        return this.handleStub('return_to_base — needs base location config');
      case 'regroup':
        return this.handleStub('regroup — needs rally point logic');
      case 'guard_zone':
        return this.handleStub('guard_zone — needs zone definition');
      case 'patrol_route':
        return this.handleStub('patrol_route — needs route definition');
      case 'deposit_inventory':
        return this.handleStub('deposit_inventory — needs container interaction');
      case 'equip_best':
        return this.handleStub('equip_best — needs equipment scoring');
      case 'unstuck':
        return this.handleUnstuck(bot);
      default:
        throw { code: 'UNKNOWN_COMMAND', message: `Unknown command type: ${type}` };
    }
  }

  private handlePauseVoyager(bot: BotInstance): Record<string, any> {
    const voyager = bot.getVoyagerLoop();
    if (!voyager) {
      throw { code: 'NO_VOYAGER', message: `${bot.name} is not running a voyager loop` } as CommandError;
    }
    voyager.pause('dashboard');
    logger.info({ botName: bot.name }, 'Voyager paused via command');
    return { paused: true };
  }

  private handleResumeVoyager(bot: BotInstance): Record<string, any> {
    const voyager = bot.getVoyagerLoop();
    if (!voyager) {
      throw { code: 'NO_VOYAGER', message: `${bot.name} is not running a voyager loop` } as CommandError;
    }
    voyager.resume();
    logger.info({ botName: bot.name }, 'Voyager resumed via command');
    return { resumed: true };
  }

  private handleStopMovement(bot: BotInstance): Record<string, any> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }
    bot.bot.pathfinder.stop();
    logger.info({ botName: bot.name }, 'Movement stopped via command');
    return { stopped: true };
  }

  private handleFollowPlayer(bot: BotInstance, params: Record<string, any>): Record<string, any> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }
    const playerName = params.playerName;
    if (!playerName) {
      throw { code: 'MISSING_PARAM', message: 'playerName is required' } as CommandError;
    }

    const target = bot.bot.players[playerName]?.entity;
    if (!target) {
      throw { code: 'PLAYER_NOT_FOUND', message: `Player "${playerName}" not found nearby` } as CommandError;
    }

    const { goals } = require('mineflayer-pathfinder');
    bot.bot.pathfinder.setGoal(new goals.GoalFollow(target, 3), true);

    logger.info({ botName: bot.name, playerName }, 'Following player via command');
    return { following: playerName };
  }

  private handleWalkToCoords(bot: BotInstance, params: Record<string, any>): Record<string, any> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }

    const { x, y, z } = params;
    if (x == null || y == null || z == null) {
      throw { code: 'MISSING_PARAM', message: 'x, y, z coordinates are required' } as CommandError;
    }

    const { goals } = require('mineflayer-pathfinder');
    bot.bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2));

    logger.info({ botName: bot.name, x, y, z }, 'Walking to coordinates via command');
    return { walkingTo: { x, y, z } };
  }

  private handleUnstuck(bot: BotInstance): Record<string, any> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }

    // Stop current movement
    bot.bot.pathfinder.stop();

    // Small random walk to get unstuck
    const pos = bot.bot.entity.position;
    const dx = (Math.random() - 0.5) * 6;
    const dz = (Math.random() - 0.5) * 6;

    const { goals } = require('mineflayer-pathfinder');
    bot.bot.pathfinder.setGoal(new goals.GoalNear(pos.x + dx, pos.y, pos.z + dz, 1));

    logger.info({ botName: bot.name }, 'Unstuck attempt via command');
    return { unstuck: true, movedTo: { x: pos.x + dx, z: pos.z + dz } };
  }

  private handleStub(note: string): Record<string, any> {
    logger.info({ note }, 'Stub command executed');
    return { stub: true, note };
  }

  // ── Status lifecycle ───────────────────────────────────────

  private updateStatus(command: CommandRecord, status: CommandStatus): void {
    command.status = status;

    if (status === 'started') {
      command.startedAt = new Date().toISOString();
    }
    if (status === 'succeeded' || status === 'failed' || status === 'cancelled') {
      command.completedAt = new Date().toISOString();
    }

    const eventKey = `command:${status}` as string;
    this.emitStatus(command, eventKey);
    this.persist();
  }

  private emitStatus(command: CommandRecord, event: string): void {
    this.io.emit(event, {
      id: command.id,
      type: command.type,
      status: command.status,
      targets: command.targets,
      error: command.error,
      result: command.result,
    });
  }

  // ── Persistence ────────────────────────────────────────────

  private persist(): void {
    try {
      // Keep only the most recent commands
      const all = [...this.commands.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, MAX_PERSISTED);

      const dir = path.dirname(DATA_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(DATA_PATH, JSON.stringify({ commands: all }, null, 2));
    } catch (err) {
      logger.error({ err }, 'Failed to persist commands');
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(DATA_PATH)) return;

      const raw = fs.readFileSync(DATA_PATH, 'utf-8');
      const data = JSON.parse(raw) as { commands: CommandRecord[] };

      for (const cmd of data.commands) {
        this.commands.set(cmd.id, cmd);
      }

      logger.info({ count: data.commands.length }, 'Loaded persisted commands');
    } catch (err) {
      logger.error({ err }, 'Failed to load persisted commands');
    }
  }
}
