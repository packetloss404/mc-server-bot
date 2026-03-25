import fs from 'fs';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { BuildCoordinator } from '../build/BuildCoordinator';
import { ChainCoordinator } from '../supplychain/ChainCoordinator';
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
  private botMissionQueues: Map<string, string[]> = new Map(); // botName → ordered mission IDs
  private botManager: BotManager;
  private io: SocketIOServer;
  private buildCoordinator?: BuildCoordinator;
  private chainCoordinator?: ChainCoordinator;
  private commandCenter?: CommandCenter;
  private squadManager?: SquadManager;
  /** Tracks which task description was queued for a running mission (missionId → description) */
  private missionTaskDescriptions: Map<string, string> = new Map();

  constructor(botManager: BotManager, io: SocketIOServer) {
    this.botManager = botManager;
    this.io = io;
    this.load();
  }

  // ── Coordinator adapters ────────────────────────────

  setBuildCoordinator(bc: BuildCoordinator): void {
    this.buildCoordinator = bc;
  }

  setChainCoordinator(cc: ChainCoordinator): void {
    this.chainCoordinator = cc;
  }

  setCommandCenter(cc: CommandCenter): void {
    this.commandCenter = cc;
  }

  setSquadManager(sm: SquadManager): void {
    this.squadManager = sm;
  }

  // ── ID generation ──────────────────────────────────

  private generateId(): string {
    return `msn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Resolve assignee IDs to bot names.
   * For assigneeType 'bot', IDs are already bot names.
   * For assigneeType 'squad', each ID is a squad ID that must be resolved via SquadManager.
   */
  private resolveAssigneeBotNames(mission: MissionRecord): string[] {
    if (mission.assigneeType === 'bot') {
      return mission.assigneeIds;
    }

    // assigneeType === 'squad'
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
    return [...new Set(botNames)]; // deduplicate
  }

  private missionTargetsBot(mission: MissionRecord, botName: string): boolean {
    const lower = botName.toLowerCase();
    return this.resolveAssigneeBotNames(mission).some((name) => name.toLowerCase() === lower);
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

    // Add to each assignee bot's queue (resolve squad IDs to bot names if needed)
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

      // By type
      if (!byType[m.type]) {
        byType[m.type] = { count: 0, completed: 0, failed: 0 };
      }
      const t = byType[m.type];
      t.count++;
      if (m.status === 'completed') t.completed++;
      else if (m.status === 'failed') t.failed++;

      // By bot
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

  /** Count missions currently in 'running' status */
  getRunningCount(): number {
    let count = 0;
    for (const m of this.missions.values()) {
      if (m.status === 'running') count++;
    }
    return count;
  }

  /** Count missions flagged as stale */
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
      // Clean up task tracking when mission reaches terminal state
      this.missionTaskDescriptions.delete(id);
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

    // Remove from bot queues (resolve squad IDs to bot names)
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

    // Reset steps
    for (const step of mission.steps) {
      if (step.status === 'failed' || step.status === 'cancelled') {
        step.status = 'pending';
        step.error = undefined;
      }
    }

    // Re-add to bot queues (resolve squad IDs to bot names if needed)
    const botNames = this.resolveAssigneeBotNames(mission);
    for (const botName of botNames) {
      this.addToBotQueue(botName, id);
    }

    mission.completedAt = undefined;
    mission.blockedReason = undefined;
    return this.updateMissionStatus(id, 'queued');
  }

  // ── Dependency check ───────────────────────────────

  /**
   * Check whether a mission's prerequisites are met.
   * If the mission has linkedCommandIds, all linked commands must have succeeded.
   */
  canStart(mission: MissionRecord): boolean {
    if (!mission.linkedCommandIds || mission.linkedCommandIds.length === 0) {
      return true;
    }

    if (!this.commandCenter) {
      // Without a CommandCenter we cannot verify dependencies; assume not ready
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

  // ── Mission execution ────────────────────────────────

  async startMission(id: string): Promise<MissionRecord | undefined> {
    const mission = this.missions.get(id);
    if (!mission) return undefined;
    if (mission.status !== 'queued' && mission.status !== 'paused') {
      logger.warn({ missionId: id, status: mission.status }, 'Cannot start mission: invalid status');
      return undefined;
    }

    // Check dependencies before starting
    if (!this.canStart(mission)) {
      const pendingCmds = (mission.linkedCommandIds ?? []).filter((cmdId) => {
        const cmd = this.commandCenter?.getCommand(cmdId);
        return !cmd || cmd.status !== 'succeeded';
      });
      logger.info(
        { missionId: id, pendingCommands: pendingCmds },
        'Mission blocked: linked commands not yet succeeded'
      );
      // Update blockedReason but keep status as queued
      mission.blockedReason = `Waiting on linked commands: ${pendingCmds.join(', ')}`;
      mission.updatedAt = Date.now();
      this.save();
      this.io.emit(MISSION_EVENTS.UPDATED, mission);
      return mission;
    }

    // Clear any previous blocked reason once dependencies are met
    if (mission.blockedReason) {
      mission.blockedReason = undefined;
    }

    switch (mission.type) {
      case 'queue_task':
        return this.executeQueueTaskMission(mission);
      case 'build_schematic':
        return this.executeBuildMission(mission);
      case 'supply_chain':
        return this.executeChainMission(mission);
      default:
        // For other mission types, just transition to running
        return this.updateMissionStatus(id, 'running');
    }
  }

  // ── VoyagerLoop bridge for queue_task missions ──────

  private executeQueueTaskMission(mission: MissionRecord): MissionRecord | undefined {
    const taskDescription = mission.description || mission.title;
    const botNames = this.resolveAssigneeBotNames(mission);

    if (botNames.length === 0) {
      logger.warn({ missionId: mission.id }, 'No bots resolved for mission, failing');
      return this.updateMissionStatus(mission.id, 'failed', { reason: 'No bots available' });
    }

    for (const botName of botNames) {
      const bot = this.botManager.getBot(botName);
      if (!bot) {
        logger.warn(
          { missionId: mission.id, botName },
          'Cannot queue task: bot not found'
        );
        continue;
      }

      const voyager = bot.getVoyagerLoop();
      if (!voyager) {
        logger.warn(
          { missionId: mission.id, botName },
          'Cannot queue task: bot has no VoyagerLoop'
        );
        continue;
      }

      voyager.queuePlayerTask(taskDescription, 'mission');
      logger.info(
        { missionId: mission.id, botName, task: taskDescription },
        'Queued task to VoyagerLoop via mission'
      );
    }

    // Track the task description so checkMissionProgress can match it
    this.missionTaskDescriptions.set(mission.id, taskDescription);

    return this.updateMissionStatus(mission.id, 'running');
  }

  // ── Mission progress checking ──────────────────────

  /**
   * Check progress of all running missions.
   * For 'queue_task' missions, inspects the VoyagerLoop to detect task completion/failure.
   * Also flags stale missions that have been running for over 30 minutes.
   *
   * Call this periodically (e.g. every 30s–60s).
   */
  checkMissionProgress(): void {
    const now = Date.now();

    for (const mission of this.missions.values()) {
      if (mission.status !== 'running') continue;

      // ── Stale mission detection ──
      if (mission.startedAt && now - mission.startedAt > STALE_THRESHOLD_MS) {
        if (mission.blockedReason !== 'Stale - running for over 30 minutes') {
          mission.blockedReason = 'Stale - running for over 30 minutes';
          mission.updatedAt = now;
          this.save();
          this.io.emit(MISSION_EVENTS.UPDATED, mission);
          logger.warn(
            { missionId: mission.id, botName: mission.assigneeIds[0], reason: 'Running for over 30 minutes', runningSinceMs: now - mission.startedAt },
            'Mission stale'
          );
        }
      }

      // ── queue_task completion tracking ──
      if (mission.type === 'queue_task') {
        this.checkQueueTaskProgress(mission);
      }
    }
  }

  private checkQueueTaskProgress(mission: MissionRecord): void {
    const trackedDescription = this.missionTaskDescriptions.get(mission.id);
    if (!trackedDescription) return;

    const botNames = this.resolveAssigneeBotNames(mission);
    let completedCount = 0;
    let failedCount = 0;
    let failedBotName: string | undefined;
    const totalAssignees = botNames.length;

    // Check ALL assigned bots' VoyagerLoops for completion
    for (const botName of botNames) {
      const bot = this.botManager.getBot(botName);
      if (!bot) continue;

      const voyager = bot.getVoyagerLoop();
      if (!voyager) continue;

      const completedTasks = voyager.getCompletedTasks();
      const failedTasks = voyager.getFailedTasks();

      if (completedTasks.includes(trackedDescription)) {
        completedCount++;
      } else if (failedTasks.includes(trackedDescription)) {
        failedCount++;
        if (!failedBotName) failedBotName = botName;
      }
      // If neither completed nor failed, the bot is still working on it
    }

    // Fail the mission if any bot failed
    if (failedCount > 0) {
      logger.info(
        { missionId: mission.id, failedCount, totalAssignees, task: trackedDescription },
        'Mission task failed: one or more bots failed'
      );
      this.updateMissionStatus(mission.id, 'failed', {
        error: `Task failed on ${failedCount}/${totalAssignees} bot(s): ${trackedDescription}`,
      });
      return;
    }

    // Complete only when ALL assignees have finished
    if (completedCount >= totalAssignees && totalAssignees > 0) {
      logger.info(
        { missionId: mission.id, completedCount, totalAssignees, task: trackedDescription },
        'Mission task completed by all assignees'
      );
      this.updateMissionStatus(mission.id, 'completed');
      return;
    }

    // Otherwise, still in progress — let stale detector handle truly stuck missions
  }

  private async executeBuildMission(mission: MissionRecord): Promise<MissionRecord | undefined> {
    if (!this.buildCoordinator) {
      logger.error({ missionId: mission.id }, 'Cannot execute build mission: BuildCoordinator not set');
      return this.updateMissionStatus(mission.id, 'failed', { error: 'BuildCoordinator not available' });
    }

    // Extract build parameters from the first step's payload or from assigneeIds
    const payload = mission.steps[0]?.payload ?? {};
    const schematicFile = (payload.schematicFile as string) ?? '';
    const origin = (payload.origin as { x: number; y: number; z: number }) ?? { x: 0, y: 0, z: 0 };
    const botNames = (payload.botNames as string[]) ?? mission.assigneeIds;

    if (!schematicFile) {
      logger.error({ missionId: mission.id }, 'Build mission missing schematicFile in step payload');
      return this.updateMissionStatus(mission.id, 'failed', { error: 'Missing schematicFile in step payload' });
    }

    try {
      const job = await this.buildCoordinator.startBuild(schematicFile, origin, botNames);
      // Link the build job ID to the mission
      if (mission.steps[0]) {
        mission.steps[0].payload.buildJobId = job.id;
        mission.steps[0].status = 'running';
      }
      logger.info({ missionId: mission.id, buildJobId: job.id }, 'Build mission started');
      return this.updateMissionStatus(mission.id, 'running');
    } catch (err: any) {
      logger.error({ err, missionId: mission.id }, 'Failed to start build mission');
      return this.updateMissionStatus(mission.id, 'failed', { error: err.message });
    }
  }

  private executeChainMission(mission: MissionRecord): MissionRecord | undefined {
    if (!this.chainCoordinator) {
      logger.error({ missionId: mission.id }, 'Cannot execute chain mission: ChainCoordinator not set');
      return this.updateMissionStatus(mission.id, 'failed', { error: 'ChainCoordinator not available' });
    }

    // Extract chain ID from the first step's payload
    const payload = mission.steps[0]?.payload ?? {};
    const chainId = (payload.chainId as string) ?? '';

    if (!chainId) {
      logger.error({ missionId: mission.id }, 'Chain mission missing chainId in step payload');
      return this.updateMissionStatus(mission.id, 'failed', { error: 'Missing chainId in step payload' });
    }

    const started = this.chainCoordinator.startChain(chainId);
    if (!started) {
      logger.error({ missionId: mission.id, chainId }, 'Failed to start supply chain');
      return this.updateMissionStatus(mission.id, 'failed', { error: `Failed to start chain ${chainId}` });
    }

    if (mission.steps[0]) {
      mission.steps[0].payload.chainId = chainId;
      mission.steps[0].status = 'running';
    }
    logger.info({ missionId: mission.id, chainId }, 'Supply chain mission started');
    return this.updateMissionStatus(mission.id, 'running');
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
