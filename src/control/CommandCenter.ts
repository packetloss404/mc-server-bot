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
import { MarkerStore } from './MarkerStore';
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
  /** Alias for params — either field is accepted */
  payload?: Record<string, any>;
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
  private markerStore: MarkerStore | null;

  constructor(botManager: BotManager, io: SocketIOServer, markerStore?: MarkerStore) {
    this.botManager = botManager;
    this.io = io;
    this.markerStore = markerStore ?? null;
    this.loadFromDisk();
  }

  // ── ID generation ──────────────────────────────────────────

  private generateId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── Public API ─────────────────────────────────────────────

  createCommand(input: CreateCommandParams): CommandRecord {
    // Accept either `params` or `payload` for backward compat
    const resolvedParams = input.params ?? input.payload ?? {};

    const command: CommandRecord = {
      id: this.generateId(),
      type: input.type,
      scope: input.scope ?? 'single',
      priority: input.priority ?? 'normal',
      source: input.source ?? 'api',
      status: 'queued',
      targets: input.targets,
      params: resolvedParams,
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
        return this.handleMoveToMarker(bot, params);
      case 'return_to_base':
        return this.handleReturnToBase(bot);
      case 'regroup':
        return this.handleRegroup(bot, params);
      case 'guard_zone':
        return this.handleGuardZone(bot, params);
      case 'patrol_route':
        return this.handlePatrolRoute(bot, params);
      case 'deposit_inventory':
        return this.handleDepositInventory(bot);
      case 'equip_best':
        return this.handleEquipBest(bot);
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

  private handleMoveToMarker(bot: BotInstance, params: Record<string, any>): Record<string, any> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }
    if (!this.markerStore) {
      throw { code: 'NO_MARKER_STORE', message: 'MarkerStore is not available' } as CommandError;
    }

    const markerId = params.markerId;
    if (!markerId) {
      throw { code: 'MISSING_PARAM', message: 'markerId is required' } as CommandError;
    }

    const marker = this.markerStore.getMarker(markerId);
    if (!marker) {
      throw { code: 'MARKER_NOT_FOUND', message: `Marker "${markerId}" not found` } as CommandError;
    }

    const { x, y, z } = marker.position;
    const { goals } = require('mineflayer-pathfinder');
    bot.bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2));

    logger.info({ botName: bot.name, markerId, markerName: marker.name, x, y, z }, 'Moving to marker via command');
    return { movingToMarker: marker.name, position: { x, y, z } };
  }

  private handleReturnToBase(bot: BotInstance): Record<string, any> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }
    if (!this.markerStore) {
      throw { code: 'NO_MARKER_STORE', message: 'MarkerStore is not available — cannot locate base' } as CommandError;
    }

    const pos = bot.bot.entity.position;
    const baseMarker = this.markerStore.findNearestMarker({ x: pos.x, y: pos.y, z: pos.z }, 'base');
    if (!baseMarker) {
      throw { code: 'NO_BASE', message: 'No base marker found' } as CommandError;
    }

    const { x, y, z } = baseMarker.position;
    const { goals } = require('mineflayer-pathfinder');
    bot.bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2));

    logger.info({ botName: bot.name, baseName: baseMarker.name, x, y, z }, 'Returning to base via command');
    return { returningToBase: baseMarker.name, position: { x, y, z } };
  }

  private handleRegroup(bot: BotInstance, params: Record<string, any>): Record<string, any> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }

    // If a rally marker is specified, use it; otherwise try to find the nearest base
    const rallyMarkerId = params.markerId ?? params.rallyMarkerId;
    let targetX: number;
    let targetY: number;
    let targetZ: number;
    let targetName: string;

    if (rallyMarkerId && this.markerStore) {
      const marker = this.markerStore.getMarker(rallyMarkerId);
      if (!marker) {
        throw { code: 'MARKER_NOT_FOUND', message: `Rally marker "${rallyMarkerId}" not found` } as CommandError;
      }
      targetX = marker.position.x;
      targetY = marker.position.y;
      targetZ = marker.position.z;
      targetName = marker.name;
    } else if (params.x != null && params.y != null && params.z != null) {
      targetX = params.x;
      targetY = params.y;
      targetZ = params.z;
      targetName = `coords(${params.x}, ${params.y}, ${params.z})`;
    } else if (this.markerStore) {
      const pos = bot.bot.entity.position;
      const baseMarker = this.markerStore.findNearestMarker({ x: pos.x, y: pos.y, z: pos.z }, 'base');
      if (!baseMarker) {
        throw { code: 'NO_RALLY_POINT', message: 'No rally point or base marker found for regroup' } as CommandError;
      }
      targetX = baseMarker.position.x;
      targetY = baseMarker.position.y;
      targetZ = baseMarker.position.z;
      targetName = baseMarker.name;
    } else {
      throw { code: 'NO_RALLY_POINT', message: 'No rally point specified and MarkerStore is not available' } as CommandError;
    }

    const { goals } = require('mineflayer-pathfinder');
    bot.bot.pathfinder.setGoal(new goals.GoalNear(targetX, targetY, targetZ, 3));

    logger.info({ botName: bot.name, targetName, x: targetX, y: targetY, z: targetZ }, 'Regrouping via command');
    return { regroupingAt: targetName, position: { x: targetX, y: targetY, z: targetZ } };
  }

  private handleGuardZone(bot: BotInstance, params: Record<string, any>): Record<string, any> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }
    if (!this.markerStore) {
      throw { code: 'NO_MARKER_STORE', message: 'MarkerStore is not available' } as CommandError;
    }

    const zoneId = params.zoneId;
    if (!zoneId) {
      throw { code: 'MISSING_PARAM', message: 'zoneId is required' } as CommandError;
    }

    const zone = this.markerStore.getZone(zoneId);
    if (!zone) {
      throw { code: 'ZONE_NOT_FOUND', message: `Zone "${zoneId}" not found` } as CommandError;
    }

    let centerX: number;
    let centerZ: number;

    if (zone.shape === 'circle' && zone.circle) {
      centerX = zone.circle.x;
      centerZ = zone.circle.z;
    } else if (zone.shape === 'rectangle' && zone.rectangle) {
      const r = zone.rectangle;
      centerX = (r.minX + r.maxX) / 2;
      centerZ = (r.minZ + r.maxZ) / 2;
    } else {
      throw { code: 'INVALID_ZONE', message: `Zone "${zoneId}" has no valid shape data` } as CommandError;
    }

    // Use the bot's current Y since zones are 2D
    const y = bot.bot.entity.position.y;

    const { goals } = require('mineflayer-pathfinder');
    bot.bot.pathfinder.setGoal(new goals.GoalNear(centerX, y, centerZ, 2));

    logger.info({ botName: bot.name, zoneId, zoneName: zone.name, centerX, centerZ }, 'Guarding zone via command');
    return { guardingZone: zone.name, center: { x: centerX, z: centerZ } };
  }

  private handlePatrolRoute(bot: BotInstance, params: Record<string, any>): Record<string, any> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }
    if (!this.markerStore) {
      throw { code: 'NO_MARKER_STORE', message: 'MarkerStore is not available' } as CommandError;
    }

    const routeId = params.routeId;
    if (!routeId) {
      throw { code: 'MISSING_PARAM', message: 'routeId is required' } as CommandError;
    }

    const route = this.markerStore.getRoute(routeId);
    if (!route) {
      throw { code: 'ROUTE_NOT_FOUND', message: `Route "${routeId}" not found` } as CommandError;
    }

    if (route.waypointIds.length === 0) {
      throw { code: 'EMPTY_ROUTE', message: `Route "${route.name}" has no waypoints` } as CommandError;
    }

    // Resolve the first waypoint marker
    const firstWaypointId = route.waypointIds[0];
    const firstMarker = this.markerStore.getMarker(firstWaypointId);
    if (!firstMarker) {
      throw {
        code: 'WAYPOINT_NOT_FOUND',
        message: `First waypoint marker "${firstWaypointId}" not found for route "${route.name}"`,
      } as CommandError;
    }

    const { x, y, z } = firstMarker.position;
    const { goals } = require('mineflayer-pathfinder');
    bot.bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2));

    logger.info(
      { botName: bot.name, routeId, routeName: route.name, firstWaypoint: firstMarker.name, waypointCount: route.waypointIds.length },
      'Patrol started — moving to first waypoint',
    );
    return {
      patrolling: route.name,
      currentWaypoint: firstMarker.name,
      waypointCount: route.waypointIds.length,
      note: 'Moving to first waypoint; full patrol loop not yet implemented',
    };
  }

  private handleDepositInventory(bot: BotInstance): Record<string, any> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }

    // Deposit is complex (needs async chest interaction). Return a clear message for now.
    logger.info({ botName: bot.name }, 'Deposit inventory requested (not yet fully implemented)');
    return {
      deposited: false,
      note: 'deposit_inventory is not yet fully implemented — chest interaction requires async flow',
    };
  }

  private handleEquipBest(bot: BotInstance): Record<string, any> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }

    const inventory = bot.bot.inventory.items();
    // Prefer swords, then pickaxes, then axes as general-purpose best equipment
    const weaponPriority = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword',
      'netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'wooden_pickaxe',
      'netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'];

    let bestItem: any = null;
    let bestRank = weaponPriority.length;

    for (const item of inventory) {
      const rank = weaponPriority.indexOf(item.name);
      if (rank !== -1 && rank < bestRank) {
        bestRank = rank;
        bestItem = item;
      }
    }

    if (!bestItem) {
      throw { code: 'NO_EQUIPMENT', message: 'No sword, pickaxe, or axe found in inventory' } as CommandError;
    }

    // bot.bot.equip returns a promise but we fire-and-forget since the caller awaits executeHandler
    bot.bot.equip(bestItem, 'hand').catch((err: any) => {
      logger.warn({ botName: bot.name, err: err?.message }, 'Failed to equip item');
    });

    logger.info({ botName: bot.name, item: bestItem.name }, 'Equipping best item via command');
    return { equipping: bestItem.name, slot: bestItem.slot };
  }

  private async handleUnstuck(bot: BotInstance): Promise<Record<string, any>> {
    if (!bot.bot) {
      throw { code: 'BOT_OFFLINE', message: `${bot.name} is not connected` } as CommandError;
    }

    // Stop current movement
    bot.bot.pathfinder.stop();

    // Jump to help dislodge from stuck positions
    bot.bot.setControlState('jump', true);
    await new Promise((resolve) => setTimeout(resolve, 500));
    bot.bot.setControlState('jump', false);

    // Small random walk to get unstuck
    const pos = bot.bot.entity.position;
    const dx = (Math.random() - 0.5) * 8;
    const dz = (Math.random() - 0.5) * 8;

    const { goals } = require('mineflayer-pathfinder');
    bot.bot.pathfinder.setGoal(new goals.GoalNear(pos.x + dx, pos.y, pos.z + dz, 1));

    logger.info({ botName: bot.name, dx, dz }, 'Unstuck attempt via command (jump + random walk)');
    return { unstuck: true, jumped: true, movedTo: { x: pos.x + dx, z: pos.z + dz } };
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
