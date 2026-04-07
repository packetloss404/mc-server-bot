import fs from 'fs';
import path from 'path';
import { BotMode } from './BotState';
import { Config } from '../config';
import { logger } from '../util/logger';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import { LLMClient } from '../ai/LLMClient';

const DEBOUNCE_MS = 1_000;
import { AffinityManager } from '../personality/AffinityManager';
import { ConversationManager } from '../personality/ConversationManager';
import { SocialMemory } from '../social/SocialMemory';
import { BotComms } from '../social/BotComms';
import { BlackboardManager } from '../voyager/BlackboardManager';
import { WorkerHandle } from '../worker/WorkerHandle';
import { SharedWorldModel } from '../voyager/SharedWorldModel';
import { SwarmCoordinator } from '../voyager/SwarmCoordinator';
import { DungeonMaster } from '../voyager/DungeonMaster';
import { DifficultyBalancer } from '../voyager/DifficultyBalancer';
import { PlayerIntentModel } from '../voyager/PlayerIntentModel';
import { BotReputation } from '../voyager/BotReputation';

interface SavedBot {
  name: string;
  personality: string;
  mode: string;
  spawnLocation?: { x: number; y: number; z: number };
}

export class BotManager {
  private workers: Map<string, WorkerHandle> = new Map();
  private config: Config;
  private dataPath: string;
  private llmClient: LLMClient | null;
  private affinityManager: AffinityManager;
  private conversationManager: ConversationManager;
  private socialMemory: SocialMemory;
  private botComms: BotComms;
  private blackboardManager: BlackboardManager;
  private sharedWorldModel: SharedWorldModel;
  private swarmCoordinator: SwarmCoordinator;
  private dungeonMaster: DungeonMaster;
  private difficultyBalancer: DifficultyBalancer;
  private playerIntentModel: PlayerIntentModel;
  private botReputation: BotReputation;
  private watchdogInterval: NodeJS.Timeout | null = null;
  private dungeonMasterInterval: NodeJS.Timeout | null = null;
  private nextStaggerAt = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Config, llmClient: LLMClient | null) {
    this.config = config;
    this.dataPath = path.join(process.cwd(), 'data', 'bots.json');
    this.llmClient = llmClient;
    this.affinityManager = new AffinityManager(config.affinity, path.join(process.cwd(), 'data'));
    this.conversationManager = new ConversationManager();
    this.socialMemory = new SocialMemory(path.join(process.cwd(), 'data'));
    this.botComms = new BotComms();
    this.blackboardManager = new BlackboardManager(path.join(process.cwd(), 'data'));
    this.sharedWorldModel = new SharedWorldModel(path.join(process.cwd(), 'data'));
    this.swarmCoordinator = new SwarmCoordinator(this.blackboardManager);
    this.dungeonMaster = new DungeonMaster();
    this.difficultyBalancer = new DifficultyBalancer();
    this.playerIntentModel = new PlayerIntentModel();
    this.botReputation = new BotReputation(path.join(process.cwd(), 'data'));

    // DungeonMaster: tick every 90s, evaluate world state, fan out tasks for new events.
    this.dungeonMasterInterval = setInterval(() => this.tickDungeonMaster(), 90_000);
  }

  /**
   * Build a world snapshot and ask DungeonMaster if a new event should fire.
   * If one does, queue its tasks on each connected worker.
   */
  private tickDungeonMaster(): void {
    if (this.workers.size === 0) return;
    try {
      const sharedState = this.sharedWorldModel.getSnapshot();
      const bots = [...this.workers.values()];
      const totalHealth = bots.reduce((sum, w) => sum + ((w.lastStatus?.health as number) ?? 20), 0);
      const snapshot = {
        botCount: bots.length,
        playerCount: 0,
        serverTimeOfDay: sharedState.serverTime,
        weather: sharedState.weather,
        totalResources: sharedState.resources.reduce<Record<string, number>>((acc, r) => {
          acc[r.name] = (acc[r.name] ?? 0) + 1;
          return acc;
        }, {}),
        recentCompletedTasks: 0,
        exploredChunkCount: sharedState.exploredChunks.size,
        activeThreatCount: sharedState.threats.length,
        averageBotHealth: bots.length > 0 ? totalHealth / bots.length : 20,
      };

      const event = this.dungeonMaster.evaluateAndGenerate(snapshot);
      if (!event) return;

      logger.info({ eventId: event.id, type: event.type, title: event.title }, 'DungeonMaster fanning event tasks to workers');
      // Queue the highest-priority task on each worker. Bots can pick it up via the
      // normal player-task path; lower-priority tasks fall out as the event ages.
      const task = event.tasks[0];
      if (!task) return;
      for (const worker of bots) {
        try {
          worker.sendCommand('queueTask', { description: task.description, source: 'dungeon_master' });
        } catch (err: any) {
          logger.warn({ bot: worker.botName, err: err.message }, 'Failed to queue DungeonMaster task');
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'DungeonMaster tick failed');
    }
  }

  async spawnBot(
    name: string,
    personality: string,
    location?: { x: number; y: number; z: number },
    mode?: string
  ): Promise<WorkerHandle | null> {
    const key = name.toLowerCase();

    if (this.workers.has(key)) {
      logger.warn({ bot: name }, 'Bot already exists');
      return null;
    }

    if (this.workers.size >= this.config.bots.maxBots) {
      logger.warn('Max bot limit reached');
      return null;
    }

    const effectiveMode = mode || this.config.bots.defaultMode;

    // Stagger bot connections
    const staggerMs = Math.max(0, this.config.bots.joinStaggerMs || 0);
    const now = Date.now();
    const waitUntil = Math.max(now, this.nextStaggerAt);
    this.nextStaggerAt = waitUntil + staggerMs;
    const delay = waitUntil - now;

    const handle = new WorkerHandle(
      { botName: name, personality, mode: effectiveMode, spawnLocation: location },
      this.llmClient,
      this.affinityManager,
      this.conversationManager,
      this.blackboardManager,
      this.sharedWorldModel,
      (description, requestedBy) => this.handleSwarmDirective(description, requestedBy),
    );

    // Wire reputation listener immediately so it's ready before the worker sends events
    handle.setReputationListener((event) => {
      this.botReputation.recordEvent(event);
    });

    this.workers.set(key, handle);

    // Start the worker (with optional stagger delay)
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }
    handle.start();

    this.saveBots();
    logger.info({ bot: name, personality, mode: effectiveMode, worker: true }, 'Bot spawned in worker thread');
    return handle;
  }

  async removeBot(name: string): Promise<boolean> {
    const key = name.toLowerCase();
    const handle = this.workers.get(key);
    if (!handle) return false;

    await handle.terminate();
    this.workers.delete(key);
    this.saveBots();

    logger.info({ bot: name }, 'Bot removed');
    return true;
  }

  async removeAllBots(): Promise<number> {
    const count = this.workers.size;
    const names = [...this.workers.keys()];

    for (const name of names) {
      await this.removeBot(name);
    }

    return count;
  }

  /** Flush all pending debounced writes across every data manager. */
  shutdownPersistence(): void {
    if (this.dungeonMasterInterval) {
      clearInterval(this.dungeonMasterInterval);
      this.dungeonMasterInterval = null;
    }
    this.affinityManager.shutdown();
    this.socialMemory.shutdown();
    this.blackboardManager.shutdown();
    if (typeof (this.sharedWorldModel as any).shutdown === 'function') (this.sharedWorldModel as any).shutdown();
    if (typeof (this.botReputation as any).shutdown === 'function') (this.botReputation as any).shutdown();
  }

  getWorker(name: string): WorkerHandle | undefined {
    return this.workers.get(name.toLowerCase());
  }

  /** Get all worker handles */
  getAllWorkers(): WorkerHandle[] {
    return [...this.workers.values()];
  }

  /** Get cached status for all bots (for API compat) */
  getAllBotStatuses(): any[] {
    return this.getAllWorkers().map((w) => w.getCachedStatus()).filter(Boolean);
  }

  getDiagnosticsSnapshot() {
    const bots = this.getAllWorkers()
      .map((w) => w.getCachedDiagnostics())
      .filter(Boolean);
    return {
      totalBots: bots.length,
      bots,
    };
  }

  getAffinityManager(): AffinityManager {
    return this.affinityManager;
  }

  getConversationManager(): ConversationManager {
    return this.conversationManager;
  }

  getSocialMemory(): SocialMemory {
    return this.socialMemory;
  }

  getBotComms(): BotComms {
    return this.botComms;
  }

  getBlackboardManager(): BlackboardManager {
    return this.blackboardManager;
  }

  getLLMClient(): LLMClient | null {
    return this.llmClient;
  }

  getSharedWorldModel(): SharedWorldModel { return this.sharedWorldModel; }
  getSwarmCoordinator(): SwarmCoordinator { return this.swarmCoordinator; }
  getDungeonMaster(): DungeonMaster { return this.dungeonMaster; }
  getDifficultyBalancer(): DifficultyBalancer { return this.difficultyBalancer; }
  getPlayerIntentModel(): PlayerIntentModel { return this.playerIntentModel; }
  getBotReputation(): BotReputation { return this.botReputation; }

  async handleSwarmDirective(description: string, requestedBy: string): Promise<void> {
    // Broadcast swarm directive to all workers — this clears local queues and interrupts current tasks
    for (const handle of this.workers.values()) {
      handle.sendCommand('swarmDirective', { description, requestedBy });
    }

    // Build bot capabilities snapshot for SwarmCoordinator's role-aware assignment.
    const capabilities = [...this.workers.values()].map((w) => {
      const status: any = w.lastStatus ?? {};
      return {
        name: w.botName,
        personality: w.personality,
        position: status.position ?? { x: 0, y: 64, z: 0 },
        inventory: (status.inventory as Record<string, number>) ?? {},
        idle: !status.currentTask,
        skills: [] as string[],
      };
    });

    // Decompose into subtasks and let SwarmCoordinator post them to the blackboard.
    // Workers will pick them up via their normal blackboardManager.claimBestTask() flow.
    let decomposed = false;
    try {
      const plan = this.swarmCoordinator.decomposeGoal(description, capabilities);
      decomposed = plan.tasks.length > 0;
      logger.info({ planId: plan.id, taskCount: plan.tasks.length, requestedBy }, 'Swarm directive decomposed into plan');
    } catch (err: any) {
      logger.warn({ err: err.message, description }, 'SwarmCoordinator decompose failed, falling back to direct broadcast');
    }

    // Fallback (or supplement when decomposition produces no tasks): queue the raw
    // directive on each worker so they at least try the literal request.
    if (!decomposed) {
      for (const handle of this.workers.values()) {
        handle.sendCommand('queueTask', { description, source: requestedBy });
      }
    }
  }

  setMode(name: string, mode: string): boolean {
    const handle = this.workers.get(name.toLowerCase());
    if (!handle) return false;

    handle.sendCommand('setMode', { mode });
    this.saveBots();
    return true;
  }

  /** Start a watchdog that reconnects disconnected bots every 60 seconds. */
  startWatchdog(): void {
    if (this.watchdogInterval) return;
    this.watchdogInterval = setInterval(() => this.watchdogTick(), 60_000);
    logger.info('Bot watchdog started (60s interval)');
  }

  stopWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  private watchdogTick(): void {
    for (const handle of this.workers.values()) {
      const status = handle.getCachedStatus();
      if (status?.state === 'DISCONNECTED') {
        logger.info({ bot: handle.botName }, 'Watchdog: restarting disconnected worker');
        handle.sendCommand('reconnect', {});
      }
    }
  }

  private saveBots(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveBotsImmediate();
    }, DEBOUNCE_MS);
  }

  private saveBotsImmediate(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      const data: SavedBot[] = this.getAllWorkers().map((w) => ({
        name: w.botName,
        personality: w.personality,
        mode: w.mode,
        spawnLocation: w.getCachedStatus()?.position || w.spawnLocation || undefined,
      }));

      atomicWriteJsonSync(this.dataPath, { bots: data });
    } catch (err) {
      logger.error({ err }, 'Failed to save bots');
    }
  }

  /** Flush any pending debounced writes to disk immediately. */
  flush(): void {
    this.saveBotsImmediate();
  }

  async loadSavedBots(): Promise<void> {
    if (!fs.existsSync(this.dataPath)) {
      logger.info('No saved bots found');
      return;
    }

    try {
      const raw = fs.readFileSync(this.dataPath, 'utf-8');
      const data = JSON.parse(raw) as { bots: SavedBot[] };

      for (const saved of data.bots) {
        await this.spawnBot(saved.name, saved.personality, saved.spawnLocation, saved.mode);
      }

      logger.info({ count: data.bots.length }, 'Loaded saved bots');
    } catch (err) {
      logger.error({ err }, 'Failed to load saved bots');
    }
  }
}
