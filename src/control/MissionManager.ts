import fs from 'fs';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { CommandCenter } from './CommandCenter';
import { SquadManager } from './SquadManager';
import { logger } from '../util/logger';
import {
  MissionRecord,
  MissionStatus,
  MissionPriority,
  MissionSource,
  MissionType,
  MISSION_EVENTS,
} from './MissionTypes';

const DATA_DIR = './data';
const MISSIONS_FILE = path.join(DATA_DIR, 'missions.json');
const STALE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

export interface MissionMetrics {
  totalCreated: number;
  totalCompleted: number;
  totalFailed: number;
  totalCancelled: number;
  byType: Record<string, { count: number; completed: number; failed: number }>;
  byBot: Record<string, { count: number; completed: number; failed: number }>;
}

export interface CreateMissionParams {
  type: MissionType;
  title: string;
  description?: string;
  assigneeType: 'bot' | 'squad';
  assigneeIds: string[];
  priority?: MissionPriority;
  source?: MissionSource;
  steps?: MissionRecord['steps'];
  linkedCommandIds?: string[];
}

export interface MissionFilters {
  bot?: string;
  squad?: string;
  status?: MissionStatus;
  limit?: number;
}

export class MissionManager {
  private missions: Map<string, MissionRecord> = new Map();
  private botMissionQueues: Map<string, string[]> = new Map();
  private botManager: BotManager;
  private io: SocketIOServer;
  private commandCenter?: CommandCenter;
  private squadManager?: SquadManager;
  private missionTaskDescriptions: Map<string, string> = new Map();

  constructor(botManager: BotManager, io: SocketIOServer) {
    this.botManager = botManager;
    this.io = io;
    this.load();
  }

  setCommandCenter(cc: CommandCenter): void {
    this.commandCenter = cc;
  }

  setSquadManager(sm: SquadManager): void {
    this.squadManager = sm;
  }

  // -- ID generation --

  private generateId(): string {
    return `msn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private resolveAssigneeBotNames(mission: MissionRecord): string[] {
    if (mission.assigneeType === 'bot') {
      return mission.assigneeIds;
    }

    if (!this.squadManager) {
      logger.warn(
        { missionId: mission.id },
        'Cannot resolve squad assignees: SquadManager not set'
      );
      return [];
    }

    const botNames: string[] = [];
    for (const squadId of mission.assigneeIds) {
      const squad = this.squadManager.getSquad(squadId);
      if (squad) {
        botNames.push(...squad.botNames);
      } else {
        logger.warn(
          { missionId: mission.id, squadId },
          'Squad not found when resolving mission assignees'
        );
      }
    }
    return [...new Set(botNames)];
  }

  private missionTargetsBot(mission: MissionRecord, botName: string): boolean {
    const lower = botName.toLowerCase();
    return this.resolveAssigneeBotNames(mission).some((name) => name.toLowerCase() === lower);
  }

  // -- CRUD --

  createMission(params: CreateMissionParams): MissionRecord {
    const now = Date.now();
    const mission: MissionRecord = {
      id: this.generateId(),
      type: params.type,
      title: params.title,
      description: params.description,
      assigneeType: params.assigneeType,
      assigneeIds: params.assigneeIds,
      status: 'queued',
      priority: params.priority ?? 'normal',
      steps: params.steps ?? [],
      createdAt: now,
      updatedAt: now,
      source: params.source ?? 'dashboard',
      linkedCommandIds: params.linkedCommandIds,
    };

    this.missions.set(mission.id, mission);

    const botNames = this.resolveAssigneeBotNames(mission);
    for (const botName of botNames) {
      this.addToBotQueue(botName, mission.id);
    }

    this.save();
    this.io.emit(MISSION_EVENTS.CREATED, mission);
    logger.info({ missionId: mission.id, title: mission.title, assignees: mission.assigneeIds }, 'Mission created');
    return mission;
  }

  getMissions(filters?: MissionFilters): MissionRecord[] {
    let results = Array.from(this.missions.values());

    if (filters?.bot) {
      results = results.filter((m) => this.missionTargetsBot(m, filters.bot!));
    }
    if (filters?.squad) {
      results = results.filter(
        (m) => m.assigneeType === 'squad' && m.assigneeIds.includes(filters.squad!)
      );
    }
    if (filters?.status) {
      results = results.filter((m) => m.status === filters.status);
    }

    const priorityOrder: Record<MissionPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
    results.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority] || a.createdAt - b.createdAt);

    if (filters?.limit && filters.limit > 0) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  getMission(id: string): MissionRecord | undefined {
    return this.missions.get(id);
  }

  getMetrics(): MissionMetrics {
    const all = [...this.missions.values()];

    let totalCompleted = 0;
    let totalFailed = 0;
    let totalCancelled = 0;

    const byType: Record<string, { count: number; completed: number; failed: number }> = {};
    const byBot: Record<string, { count: number; completed: number; failed: number }> = {};

    for (const m of all) {
      if (m.status === 'completed') totalCompleted++;
      else if (m.status === 'failed') totalFailed++;
      else if (m.status === 'cancelled') totalCancelled++;

      if (!byType[m.type]) {
        byType[m.type] = { count: 0, completed: 0, failed: 0 };
      }
      const t = byType[m.type];
      t.count++;
      if (m.status === 'completed') t.completed++;
      else if (m.status === 'failed') t.failed++;

      for (const botName of (m.assigneeIds || [])) {
        if (!byBot[botName]) {
          byBot[botName] = { count: 0, completed: 0, failed: 0 };
        }
        const b = byBot[botName];
        b.count++;
        if (m.status === 'completed') b.completed++;
        else if (m.status === 'failed') b.failed++;
      }
    }

    return {
      totalCreated: all.length,
      totalCompleted,
      totalFailed,
      totalCancelled,
      byType,
      byBot,
    };
  }

  getRunningCount(): number {
    let count = 0;
    for (const m of this.missions.values()) {
      if (m.status === 'running') count++;
    }
    return count;
  }

  getStaleCount(): number {
    const now = Date.now();
    let count = 0;
    for (const m of this.missions.values()) {
      if (m.status === 'running' && m.startedAt && now - m.startedAt > STALE_THRESHOLD_MS) {
        count++;
      }
    }
    return count;
  }

  // -- Status transitions --

  updateMissionStatus(
    id: string,
    newStatus: MissionStatus,
    metadata?: { reason?: string; error?: string }
  ): MissionRecord | undefined {
    const mission = this.missions.get(id);
    if (!mission) return undefined;

    const oldStatus = mission.status;
    mission.status = newStatus;
    mission.updatedAt = Date.now();

    if (newStatus === 'running' && !mission.startedAt) {
      mission.startedAt = Date.now();
    }
    if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'cancelled') {
      mission.completedAt = Date.now();
      this.missionTaskDescriptions.delete(id);
    }
    if (metadata?.reason) {
      mission.blockedReason = metadata.reason;
    }

    this.save();

    const eventMap: Record<string, string> = {
      completed: MISSION_EVENTS.COMPLETED,
      failed: MISSION_EVENTS.FAILED,
      cancelled: MISSION_EVENTS.CANCELLED,
    };
    const specificEvent = eventMap[newStatus];
    if (specificEvent) {
      this.io.emit(specificEvent, mission);
    }
    this.io.emit(MISSION_EVENTS.UPDATED, mission);

    logger.info(
      { missionId: id, oldStatus, newStatus, reason: metadata?.reason },
      'Mission status updated'
    );
    return mission;
  }

  pauseMission(id: string): MissionRecord | undefined {
    const mission = this.missions.get(id);
    if (!mission || (mission.status !== 'running' && mission.status !== 'queued')) {
      return undefined;
    }
    return this.updateMissionStatus(id, 'paused', { reason: 'User paused' });
  }

  resumeMission(id: string): MissionRecord | undefined {
    const mission = this.missions.get(id);
    if (!mission || mission.status !== 'paused') {
      return undefined;
    }
    return this.updateMissionStatus(id, 'queued');
  }

  cancelMission(id: string): MissionRecord | undefined {
    const mission = this.missions.get(id);
    if (!mission || mission.status === 'completed' || mission.status === 'cancelled') {
      return undefined;
    }

    const botNames = this.resolveAssigneeBotNames(mission);
    for (const botName of botNames) {
      this.removeFromBotQueue(botName, id);
    }

    return this.updateMissionStatus(id, 'cancelled', { reason: 'User cancelled' });
  }

  retryMission(id: string): MissionRecord | undefined {
    const mission = this.missions.get(id);
    if (!mission || (mission.status !== 'failed' && mission.status !== 'cancelled')) {
      return undefined;
    }

    for (const step of mission.steps) {
      if (step.status === 'failed' || step.status === 'cancelled') {
        step.status = 'pending';
        step.error = undefined;
      }
    }

    const botNames = this.resolveAssigneeBotNames(mission);
    for (const botName of botNames) {
      this.addToBotQueue(botName, id);
    }

    mission.completedAt = undefined;
    mission.blockedReason = undefined;
    return this.updateMissionStatus(id, 'queued');
  }

  // -- Dependency check --

  canStart(mission: MissionRecord): boolean {
    if (!mission.linkedCommandIds || mission.linkedCommandIds.length === 0) {
      return true;
    }

    if (!this.commandCenter) {
      logger.warn(
        { missionId: mission.id },
        'Cannot check mission dependencies: CommandCenter not set'
      );
      return false;
    }

    for (const cmdId of mission.linkedCommandIds) {
      const cmd = this.commandCenter.getCommand(cmdId);
      if (!cmd || cmd.status !== 'succeeded') {
        return false;
      }
    }

    return true;
  }

  // -- Mission execution --

  async startMission(id: string): Promise<MissionRecord | undefined> {
    const mission = this.missions.get(id);
    if (!mission) return undefined;
    if (mission.status !== 'queued' && mission.status !== 'paused') {
      logger.warn({ missionId: id, status: mission.status }, 'Cannot start mission: invalid status');
      return undefined;
    }

    if (!this.canStart(mission)) {
      const pendingCmds = (mission.linkedCommandIds ?? []).filter((cmdId) => {
        const cmd = this.commandCenter?.getCommand(cmdId);
        return !cmd || cmd.status !== 'succeeded';
      });
      logger.info(
        { missionId: id, pendingCommands: pendingCmds },
        'Mission blocked: linked commands not yet succeeded'
      );
      mission.blockedReason = `Waiting on linked commands: ${pendingCmds.join(', ')}`;
      mission.updatedAt = Date.now();
      this.save();
      this.io.emit(MISSION_EVENTS.UPDATED, mission);
      return mission;
    }

    if (mission.blockedReason) {
      mission.blockedReason = undefined;
    }

    if (mission.type === 'queue_task') {
      return this.executeQueueTaskMission(mission);
    }

    // For other mission types, just transition to running
    return this.updateMissionStatus(id, 'running');
  }

  // -- VoyagerLoop bridge for queue_task missions --

  private executeQueueTaskMission(mission: MissionRecord): MissionRecord | undefined {
    const taskDescription = mission.description || mission.title;
    const botNames = this.resolveAssigneeBotNames(mission);

    if (botNames.length === 0) {
      logger.warn({ missionId: mission.id }, 'No bots resolved for mission, failing');
      return this.updateMissionStatus(mission.id, 'failed', { reason: 'No bots available' });
    }

    for (const botName of botNames) {
      const worker = this.botManager.getWorker(botName);
      if (!worker) {
        logger.warn(
          { missionId: mission.id, botName },
          'Cannot queue task: bot not found'
        );
        continue;
      }

      worker.sendCommand('queueTask', { description: taskDescription, source: 'mission' });
      logger.info(
        { missionId: mission.id, botName, task: taskDescription },
        'Queued task to worker via mission'
      );
    }

    this.missionTaskDescriptions.set(mission.id, taskDescription);
    return this.updateMissionStatus(mission.id, 'running');
  }

  // -- Mission progress checking --

  checkMissionProgress(): void {
    const now = Date.now();

    for (const mission of this.missions.values()) {
      if (mission.status !== 'running') continue;

      // Stale mission detection
      if (mission.startedAt && now - mission.startedAt > STALE_THRESHOLD_MS) {
        if (mission.blockedReason !== 'Stale - running for over 30 minutes') {
          mission.blockedReason = 'Stale - running for over 30 minutes';
          mission.updatedAt = now;
          this.save();
          this.io.emit(MISSION_EVENTS.UPDATED, mission);
          logger.warn(
            { missionId: mission.id, botName: mission.assigneeIds[0], reason: 'Running for over 30 minutes' },
            'Mission stale'
          );
        }
      }
    }
  }

  // -- Bot mission queue management --

  getBotMissionQueue(botName: string): MissionRecord[] {
    const queueIds = this.botMissionQueues.get(botName) ?? [];
    return queueIds
      .map((id) => this.missions.get(id))
      .filter((m): m is MissionRecord => !!m && m.status !== 'completed' && m.status !== 'cancelled' && m.status !== 'failed');
  }

  updateBotMissionQueue(
    botName: string,
    action: 'remove' | 'reorder' | 'clear',
    missionId?: string,
    position?: { from: number; to: number }
  ): boolean {
    const queue = this.botMissionQueues.get(botName);
    if (!queue) return false;

    switch (action) {
      case 'remove': {
        if (!missionId) return false;
        const idx = queue.indexOf(missionId);
        if (idx === -1) return false;
        queue.splice(idx, 1);
        break;
      }
      case 'reorder': {
        if (!position || position.from < 0 || position.from >= queue.length || position.to < 0 || position.to >= queue.length) {
          return false;
        }
        const [item] = queue.splice(position.from, 1);
        queue.splice(position.to, 0, item);
        break;
      }
      case 'clear': {
        queue.length = 0;
        break;
      }
      default:
        return false;
    }

    this.save();
    return true;
  }

  private addToBotQueue(botName: string, missionId: string): void {
    if (!this.botMissionQueues.has(botName)) {
      this.botMissionQueues.set(botName, []);
    }
    const queue = this.botMissionQueues.get(botName)!;
    if (!queue.includes(missionId)) {
      queue.push(missionId);
    }
  }

  private removeFromBotQueue(botName: string, missionId: string): void {
    const queue = this.botMissionQueues.get(botName);
    if (!queue) return;
    const idx = queue.indexOf(missionId);
    if (idx !== -1) queue.splice(idx, 1);
  }

  // -- Persistence --

  private load(): void {
    try {
      if (fs.existsSync(MISSIONS_FILE)) {
        const raw = fs.readFileSync(MISSIONS_FILE, 'utf-8');
        const data = JSON.parse(raw) as {
          missions: MissionRecord[];
          botQueues: Record<string, string[]>;
        };

        for (const m of data.missions ?? []) {
          this.missions.set(m.id, m);
        }
        for (const [botName, ids] of Object.entries(data.botQueues ?? {})) {
          this.botMissionQueues.set(botName, ids);
        }
        logger.info({ count: this.missions.size }, 'Loaded missions from disk');
      }
    } catch (err: any) {
      logger.warn({ err }, 'Failed to load missions file, starting fresh');
    }
  }

  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const data = {
        missions: Array.from(this.missions.values()),
        botQueues: Object.fromEntries(this.botMissionQueues),
      };
      fs.writeFileSync(MISSIONS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: any) {
      logger.error({ err }, 'Failed to save missions file');
    }
  }
}
