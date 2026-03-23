import fs from 'fs';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
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
  private botMissionQueues: Map<string, string[]> = new Map(); // botName → ordered mission IDs
  private botManager: BotManager;
  private io: SocketIOServer;

  constructor(botManager: BotManager, io: SocketIOServer) {
    this.botManager = botManager;
    this.io = io;
    this.load();
  }

  // ── ID generation ──────────────────────────────────

  private generateId(): string {
    return `msn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── CRUD ───────────────────────────────────────────

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

    // Add to each assignee bot's queue
    if (mission.assigneeType === 'bot') {
      for (const botName of mission.assigneeIds) {
        this.addToBotQueue(botName, mission.id);
      }
    }

    this.save();
    this.io.emit(MISSION_EVENTS.CREATED, mission);
    logger.info({ missionId: mission.id, title: mission.title, assignees: mission.assigneeIds }, 'Mission created');
    return mission;
  }

  getMissions(filters?: MissionFilters): MissionRecord[] {
    let results = Array.from(this.missions.values());

    if (filters?.bot) {
      results = results.filter((m) => m.assigneeIds.includes(filters.bot!));
    }
    if (filters?.squad) {
      results = results.filter(
        (m) => m.assigneeType === 'squad' && m.assigneeIds.includes(filters.squad!)
      );
    }
    if (filters?.status) {
      results = results.filter((m) => m.status === filters.status);
    }

    // Sort by priority (urgent first) then creation time
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

  // ── Status transitions ─────────────────────────────

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
    }
    if (metadata?.reason) {
      mission.blockedReason = metadata.reason;
    }

    this.save();

    // Emit specific event based on target status
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

    // Remove from bot queues
    for (const botName of mission.assigneeIds) {
      this.removeFromBotQueue(botName, id);
    }

    return this.updateMissionStatus(id, 'cancelled', { reason: 'User cancelled' });
  }

  retryMission(id: string): MissionRecord | undefined {
    const mission = this.missions.get(id);
    if (!mission || (mission.status !== 'failed' && mission.status !== 'cancelled')) {
      return undefined;
    }

    // Reset steps
    for (const step of mission.steps) {
      if (step.status === 'failed' || step.status === 'cancelled') {
        step.status = 'pending';
        step.error = undefined;
      }
    }

    // Re-add to bot queues
    if (mission.assigneeType === 'bot') {
      for (const botName of mission.assigneeIds) {
        this.addToBotQueue(botName, id);
      }
    }

    mission.completedAt = undefined;
    mission.blockedReason = undefined;
    return this.updateMissionStatus(id, 'queued');
  }

  // ── Bot mission queue management ───────────────────

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

  // ── Persistence ────────────────────────────────────

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
      logger.warn({ err: err.message }, 'Failed to load missions file, starting fresh');
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
      logger.error({ err: err.message }, 'Failed to save missions file');
    }
  }
}
