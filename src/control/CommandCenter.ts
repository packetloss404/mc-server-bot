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
import { MarkerStore } from './MarkerStore';
import type { RoleManager } from './RoleManager';
import { logger } from '../util/logger';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import * as fs from 'fs';
import * as path from 'path';

export interface CommandMetrics {
  totalCreated: number;
  totalSucceeded: number;
  totalFailed: number;
  totalCancelled: number;
  totalTimedOut: number;
  averageDurationMs: number;
  byType: Record<string, { count: number; succeeded: number; failed: number; avgDurationMs: number }>;
  byBot: Record<string, { count: number; succeeded: number; failed: number }>;
}

export interface CreateCommandParams {
  type: CommandType;
  scope?: CommandScope;
  priority?: CommandPriority;
  source?: CommandSource;
  targets: string[];
  params?: Record<string, any>;
  payload?: Record<string, any>;
  force?: boolean;
}

interface CommandFilters {
  bot?: string;
  status?: CommandStatus;
  limit?: number;
}

const DATA_PATH = path.join(process.cwd(), 'data', 'commands.json');
const MAX_PERSISTED = 500;
const DEBOUNCE_MS = 1_000;

const MOVEMENT_COMMAND_TYPES: ReadonlySet<CommandType> = new Set([
  'walk_to_coords',
  'move_to_marker',
  'follow_player',
  'patrol_route',
  'guard_zone',
]);

const COMMAND_TIMEOUT_MS = 60_000;
const TIMEOUT_CHECK_INTERVAL_MS = 10_000;

export class CommandCenter {
  private commands: Map<string, CommandRecord> = new Map();
  private botManager: BotManager;
  private io: SocketIOServer;
  private markerStore: MarkerStore | null;
  private roleManager: RoleManager | null = null;
  private timeoutTimer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(botManager: BotManager, io: SocketIOServer, markerStore?: MarkerStore) {
    this.botManager = botManager;
    this.io = io;
    this.markerStore = markerStore ?? null;
    this.loadFromDisk();
    this.startTimeoutChecker();
  }

  setRoleManager(roleManager: RoleManager): void {
    this.roleManager = roleManager;
  }

  destroy(): void {
    if (this.timeoutTimer) {
      clearInterval(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.flush();
  }

  // -- ID generation --

  private generateId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // -- Public API --

  createCommand(input: CreateCommandParams): CommandRecord {
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

    this.logLifecycle(command, 'Command created');

    return command;
  }

  async dispatchCommand(command: CommandRecord, force?: boolean): Promise<CommandRecord> {
    // Fan-out for multi-target scopes
    if (
      (command.scope === 'squad' || command.scope === 'selection' || command.scope === 'all') &&
      command.targets.length > 1
    ) {
      return this.dispatchFanOut(command, force);
    }

    const botName = command.targets[0];
    if (!botName) {
      command.error = { code: 'NO_TARGET', message: 'No target bot specified' };
      this.updateStatus(command, 'failed');
      return command;
    }

    // Role policy: check interrupt policy before dispatching
    if (this.roleManager) {
      const verdict = this.roleManager.shouldAllowCommandDispatch(botName, force);
      if (!verdict.allowed) {
        command.error = {
          code: 'INTERRUPT_POLICY_BLOCKED',
          message: verdict.reason,
          botName,
        };
        this.updateStatus(command, 'failed');
        logger.warn(
          { commandId: command.id, botName, type: command.type, reason: verdict.reason, force },
          'Command dispatch blocked by interrupt policy',
        );
        return command;
      }
    }

    const worker = this.botManager.getWorker(botName);
    if (!worker) {
      command.error = { code: 'BOT_NOT_FOUND', message: `Bot "${botName}" not found`, botName };
      this.updateStatus(command, 'failed');
      return command;
    }

    // Cancel any active command for this bot
    await this.cancelActiveCommandForBot(botName, 'superseded');

    this.updateStatus(command, 'started');

    try {
      const result = this.executeHandler(command.type, worker, command.params);
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

  getMetrics(): CommandMetrics {
    const all = [...this.commands.values()];

    const totalCreated = all.length;
    let totalSucceeded = 0;
    let totalFailed = 0;
    let totalCancelled = 0;
    let totalTimedOut = 0;
    let totalDurationMs = 0;
    let durationCount = 0;

    const byType: Record<string, { count: number; succeeded: number; failed: number; totalDurationMs: number; durationCount: number }> = {};
    const byBot: Record<string, { count: number; succeeded: number; failed: number }> = {};

    for (const cmd of all) {
      if (cmd.status === 'succeeded') totalSucceeded++;
      else if (cmd.status === 'failed') {
        totalFailed++;
        if (cmd.error?.code === 'TIMEOUT') totalTimedOut++;
      }
      else if (cmd.status === 'cancelled') totalCancelled++;

      const duration = this.computeDurationMs(cmd);
      if (duration !== undefined) {
        totalDurationMs += duration;
        durationCount++;
      }

      if (!byType[cmd.type]) {
        byType[cmd.type] = { count: 0, succeeded: 0, failed: 0, totalDurationMs: 0, durationCount: 0 };
      }
      const t = byType[cmd.type];
      t.count++;
      if (cmd.status === 'succeeded') t.succeeded++;
      else if (cmd.status === 'failed') t.failed++;
      if (duration !== undefined) {
        t.totalDurationMs += duration;
        t.durationCount++;
      }

      const bn = cmd.targets?.[0];
      if (bn) {
        if (!byBot[bn]) {
          byBot[bn] = { count: 0, succeeded: 0, failed: 0 };
        }
        const b = byBot[bn];
        b.count++;
        if (cmd.status === 'succeeded') b.succeeded++;
        else if (cmd.status === 'failed') b.failed++;
      }
    }

    const byTypeFinal: CommandMetrics['byType'] = {};
    for (const [type, data] of Object.entries(byType)) {
      byTypeFinal[type] = {
        count: data.count,
        succeeded: data.succeeded,
        failed: data.failed,
        avgDurationMs: data.durationCount > 0 ? Math.round(data.totalDurationMs / data.durationCount) : 0,
      };
    }

    return {
      totalCreated,
      totalSucceeded,
      totalFailed,
      totalCancelled,
      totalTimedOut,
      averageDurationMs: durationCount > 0 ? Math.round(totalDurationMs / durationCount) : 0,
      byType: byTypeFinal,
      byBot,
    };
  }

  private computeDurationMs(cmd: CommandRecord): number | undefined {
    if (cmd.startedAt && cmd.completedAt) {
      return new Date(cmd.completedAt).getTime() - new Date(cmd.startedAt).getTime();
    }
    return undefined;
  }

  getCountByStatus(status: CommandStatus): number {
    let count = 0;
    for (const cmd of this.commands.values()) {
      if (cmd.status === status) count++;
    }
    return count;
  }

  getRecentFailedCount(withinMs: number): number {
    const cutoff = new Date(Date.now() - withinMs).toISOString();
    let count = 0;
    for (const cmd of this.commands.values()) {
      if (cmd.status === 'failed' && cmd.completedAt && cmd.completedAt >= cutoff) {
        count++;
      }
    }
    return count;
  }

  cancelCommand(id: string, reason?: string): CommandRecord | undefined {
    const command = this.commands.get(id);
    if (!command) return undefined;

    if (command.status === 'queued' || command.status === 'started') {
      if (reason) {
        command.error = { code: 'CANCELLED', message: reason };
      }
      this.updateStatus(command, 'cancelled');
      return command;
    }

    return command;
  }

  // -- Timeout handling --

  checkTimeouts(): void {
    const now = Date.now();

    for (const command of this.commands.values()) {
      if (command.status !== 'started') continue;
      if (!command.startedAt) continue;

      const startedMs = new Date(command.startedAt).getTime();
      const elapsed = now - startedMs;

      if (elapsed > COMMAND_TIMEOUT_MS) {
        command.error = { code: 'TIMEOUT', message: 'Command timed out' };
        this.updateStatus(command, 'failed');

        logger.warn(
          { commandId: command.id, botName: command.targets[0], type: command.type, durationMs: elapsed },
          'Command timed out',
        );
      }
    }
  }

  // -- Cancel active command for a bot --

  private async cancelActiveCommandForBot(botName: string, reason: string): Promise<void> {
    for (const command of this.commands.values()) {
      if (command.status === 'started' && command.targets.includes(botName)) {
        this.cancelCommand(command.id, reason);
        logger.info(
          { commandId: command.id, botName, type: command.type, reason },
          'Active command superseded by new command',
        );
      }
    }
  }

  // -- Fan-out --

  private async dispatchFanOut(parent: CommandRecord, force?: boolean): Promise<CommandRecord> {
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

      await this.dispatchCommand(child, force);

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

  // -- Command handlers (dispatch via WorkerHandle.sendCommand) --

  private executeHandler(
    type: CommandType,
    worker: any,
    params: Record<string, any>,
  ): Record<string, any> {
    if (!worker || !worker.isAlive()) {
      throw { code: 'BOT_OFFLINE', message: 'Bot is not connected' } as CommandError;
    }

    switch (type) {
      case 'pause_voyager':
        worker.sendCommand('setMode', { pause: true });
        return { paused: true };

      case 'resume_voyager':
        worker.sendCommand('setMode', { pause: false });
        return { resumed: true };

      case 'stop_movement':
        worker.sendCommand('stopMovement', {});
        return { stopped: true };

      case 'follow_player': {
        const playerName = params.playerName;
        if (!playerName) {
          throw { code: 'MISSING_PARAM', message: 'playerName is required' } as CommandError;
        }
        worker.sendCommand('follow', { playerName });
        return { following: playerName };
      }

      case 'walk_to_coords': {
        const { x, y, z } = params;
        if (x == null || y == null || z == null) {
          throw { code: 'MISSING_PARAM', message: 'x, y, z coordinates are required' } as CommandError;
        }
        worker.sendCommand('walkTo', { x, y, z });
        return { walkingTo: { x, y, z } };
      }

      case 'move_to_marker': {
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
        worker.sendCommand('walkTo', { x, y, z });
        return { movingToMarker: marker.name, position: { x, y, z } };
      }

      case 'return_to_base': {
        worker.sendCommand('returnToBase', {});
        return { returningToBase: true };
      }

      case 'regroup': {
        const rallyMarkerId = params.markerId ?? params.rallyMarkerId;
        if (rallyMarkerId && this.markerStore) {
          const marker = this.markerStore.getMarker(rallyMarkerId);
          if (marker) {
            worker.sendCommand('walkTo', marker.position);
            return { regroupingAt: marker.name, position: marker.position };
          }
        }
        if (params.x != null && params.y != null && params.z != null) {
          worker.sendCommand('walkTo', { x: params.x, y: params.y, z: params.z });
          return { regroupingAt: `coords(${params.x}, ${params.y}, ${params.z})` };
        }
        worker.sendCommand('returnToBase', {});
        return { regroupingAt: 'base' };
      }

      case 'guard_zone': {
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
        let centerX: number, centerZ: number;
        if (zone.shape === 'circle' && zone.circle) {
          centerX = zone.circle.x;
          centerZ = zone.circle.z;
        } else if (zone.shape === 'rectangle' && zone.rectangle) {
          centerX = (zone.rectangle.minX + zone.rectangle.maxX) / 2;
          centerZ = (zone.rectangle.minZ + zone.rectangle.maxZ) / 2;
        } else {
          throw { code: 'INVALID_ZONE', message: `Zone "${zoneId}" has no valid shape data` } as CommandError;
        }
        worker.sendCommand('walkTo', { x: centerX, y: 64, z: centerZ });
        return { guardingZone: zone.name, center: { x: centerX, z: centerZ } };
      }

      case 'patrol_route': {
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
        const firstMarker = this.markerStore.getMarker(route.waypointIds[0]);
        if (!firstMarker) {
          throw { code: 'WAYPOINT_NOT_FOUND', message: `First waypoint not found` } as CommandError;
        }
        worker.sendCommand('walkTo', firstMarker.position);
        return {
          patrolling: route.name,
          currentWaypoint: firstMarker.name,
          waypointCount: route.waypointIds.length,
        };
      }

      case 'deposit_inventory':
        worker.sendCommand('depositInventory', {});
        return { depositing: true };

      case 'equip_best':
        worker.sendCommand('equipBest', {});
        return { equipping: true };

      case 'unstuck':
        worker.sendCommand('unstuck', {});
        return { unstuck: true };

      default:
        throw { code: 'UNKNOWN_COMMAND', message: `Unknown command type: ${type}` };
    }
  }

  // -- Status lifecycle --

  private logLifecycle(command: CommandRecord, message: string): void {
    const durationMs = command.startedAt && command.completedAt
      ? new Date(command.completedAt).getTime() - new Date(command.startedAt).getTime()
      : command.startedAt
        ? Date.now() - new Date(command.startedAt).getTime()
        : undefined;

    logger.info(
      {
        commandId: command.id,
        botName: command.targets[0],
        type: command.type,
        status: command.status,
        ...(durationMs !== undefined ? { durationMs } : {}),
      },
      message,
    );
  }

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

    this.logLifecycle(command, `Command ${status}`);
  }

  private emitStatus(command: CommandRecord, event: string): void {
    this.io.emit(event, {
      id: command.id,
      type: command.type,
      status: command.status,
      targets: command.targets,
      error: command.error,
      result: command.result,
      createdAt: command.createdAt,
      startedAt: command.startedAt,
      completedAt: command.completedAt,
    });
  }

  // -- Timeout checker --

  private startTimeoutChecker(): void {
    this.timeoutTimer = setInterval(() => {
      this.checkTimeouts();
    }, TIMEOUT_CHECK_INTERVAL_MS);
  }

  // -- Persistence (debounced) --

  private persist(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.persistImmediate();
    }, DEBOUNCE_MS);
  }

  private persistImmediate(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      const all = [...this.commands.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, MAX_PERSISTED);

      atomicWriteJsonSync(DATA_PATH, { commands: all });
    } catch (err) {
      logger.error({ err }, 'Failed to persist commands');
    }
  }

  /** Flush any pending debounced writes to disk immediately. */
  flush(): void {
    this.persistImmediate();
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
