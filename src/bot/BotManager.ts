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
import { PlayerPresenceTracker } from './PlayerPresenceTracker';
import { PlayerPositionCache } from '../control/PlayerPositionCache';
import { TownManager } from '../town/TownManager';

interface SavedBot {
  name: string;
  personality: string;
  mode: string;
  spawnLocation?: { x: number; y: number; z: number };
}

export class BotManager {
  private workers: Map<string, WorkerHandle> = new Map();
  /** Tracks which prismarine-viewer slot indices are in use. Slot index → bot key. */
  private viewerSlots: Map<number, string> = new Map();
  private config: Config;
  private dataPath: string;
  /** True while loadSavedBots() is iterating; suppresses intermediate saves
   *  so a crash mid-load can't truncate bots.json down to whatever had
   *  spawned so far. See saveBots() and loadSavedBots() for context. */
  private loadingBots = false;
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
  private playerPresenceTracker: PlayerPresenceTracker;
  private playerPositionCache: PlayerPositionCache;
  private townManager: TownManager;
  private watchdogInterval: NodeJS.Timeout | null = null;
  private nextStaggerAt = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private spawnListeners: Array<(handle: WorkerHandle) => void> = [];

  constructor(config: Config, llmClient: LLMClient | null) {
    this.config = config;
    this.dataPath = path.join(process.cwd(), 'data', 'bots.json');
    this.llmClient = llmClient;
    this.affinityManager = new AffinityManager(config.affinity, path.join(process.cwd(), 'data'));
    this.conversationManager = new ConversationManager();
    this.socialMemory = new SocialMemory(path.join(process.cwd(), 'data'));
    this.botComms = BotComms.getInstance();
    this.blackboardManager = new BlackboardManager(path.join(process.cwd(), 'data'));
    this.sharedWorldModel = new SharedWorldModel(path.join(process.cwd(), 'data', 'shared_world.json'));
    this.swarmCoordinator = new SwarmCoordinator(this.blackboardManager);
    this.dungeonMaster = new DungeonMaster();
    this.difficultyBalancer = new DifficultyBalancer();
    this.playerIntentModel = new PlayerIntentModel();
    this.botReputation = new BotReputation(path.join(process.cwd(), 'data'));
    this.playerPresenceTracker = new PlayerPresenceTracker(this.difficultyBalancer);
    this.playerPositionCache = new PlayerPositionCache();
    this.townManager = new TownManager();
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

    const workerSlotIndex = this.allocateViewerSlot(key);

    const handle = new WorkerHandle(
      { botName: name, personality, mode: effectiveMode, spawnLocation: location, workerSlotIndex },
      this.llmClient,
      this.affinityManager,
      this.conversationManager,
      this.blackboardManager,
      this.sharedWorldModel,
      (description, requestedBy) => this.handleSwarmDirective(description, requestedBy),
      this.difficultyBalancer,
      this.playerIntentModel,
      // Followup #40 — resolver so Voyager's claimBestTask can boost
      // role-tagged tasks. Walks every town (small N) looking for a
      // resident row whose botName matches; returns null when this bot
      // isn't a town resident OR the town manager throws. WorkerHandle
      // caches the result for 60s so the per-claim cost is bounded.
      (botName: string): string | null => {
        try {
          const towns = this.townManager.listTowns();
          for (const town of towns) {
            const residents = this.townManager.listResidents(town.id);
            const hit = residents.find(
              (r) => r.botName.toLowerCase() === botName.toLowerCase(),
            );
            if (hit && hit.currentRole) return hit.currentRole;
          }
        } catch {
          /* swallow — role lookup is additive */
        }
        return null;
      },
    );

    // Wire reputation listener immediately so it's ready before the worker sends events
    handle.setReputationListener((event) => {
      this.botReputation.recordEvent(event);
    });

    this.workers.set(key, handle);

    for (const listener of this.spawnListeners) {
      try {
        listener(handle);
      } catch (err) {
        logger.warn({ err: (err as any)?.message, bot: name }, 'Bot spawn listener failed');
      }
    }

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
    // Free the prismarine-viewer slot so the port can be reused by another bot.
    this.viewerSlots.delete(handle.workerSlotIndex);
    this.saveBots();

    logger.info({ bot: name }, 'Bot removed');
    return true;
  }

  /**
   * Allocate a small, stable slot index for this bot's prismarine-viewer.
   * The viewer's HTTP port is derived as `3100 + slot`. We reuse the lowest
   * free slot so port assignments stay tight (and predictable) across the
   * fleet, and we never collide with a live worker.
   */
  private allocateViewerSlot(key: string): number {
    // Stable across respawn: if this bot already has a slot, keep it.
    for (const [slot, ownerKey] of this.viewerSlots) {
      if (ownerKey === key) return slot;
    }
    for (let slot = 0; slot < 1024; slot++) {
      if (!this.viewerSlots.has(slot)) {
        this.viewerSlots.set(slot, key);
        return slot;
      }
    }
    throw new Error('No free prismarine-viewer slots available');
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
    this.affinityManager.shutdown();
    this.socialMemory.shutdown();
    this.blackboardManager.shutdown();
    if (typeof (this.sharedWorldModel as any).shutdown === 'function') (this.sharedWorldModel as any).shutdown();
    if (typeof (this.botReputation as any).shutdown === 'function') (this.botReputation as any).shutdown();
  }

  getWorker(name: string): WorkerHandle | undefined {
    return this.workers.get(name.toLowerCase());
  }

  /** Register a listener fired when a new bot is spawned. Existing bots are NOT replayed. */
  onBotSpawned(listener: (handle: WorkerHandle) => void): void {
    this.spawnListeners.push(listener);
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
  getPlayerPresenceTracker(): PlayerPresenceTracker { return this.playerPresenceTracker; }
  getPlayerPositionCache(): PlayerPositionCache { return this.playerPositionCache; }
  getTownManager(): TownManager { return this.townManager; }

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
    // During the staggered loadSavedBots loop, every spawnBot call triggers
    // a save. If the process dies (OOM, restart, server kick storm) before
    // the loop finishes, that partial save permanently truncates bots.json
    // — bots that hadn't reached spawnBot yet vanish forever. Suppress saves
    // entirely while loading; loadSavedBots fires one explicit save at the
    // end. See: 2026-05-22 incident where bots.json eroded from 10 → 2.
    if (this.loadingBots) return;
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

    // Set the loading flag so partial-load saves don't truncate bots.json
    // if the process dies before the staggered loop completes. We flush one
    // canonical save at the end (or in finally on early failure).
    this.loadingBots = true;
    try {
      const raw = fs.readFileSync(this.dataPath, 'utf-8');
      const data = JSON.parse(raw) as { bots: SavedBot[] };

      // spawnBot already enforces config.bots.joinStaggerMs between launches
      // — no additional sleep needed here.
      for (const saved of data.bots) {
        await this.spawnBot(saved.name, saved.personality, saved.spawnLocation, saved.mode);
      }

      logger.info({ count: data.bots.length }, 'Loaded saved bots');
    } catch (err) {
      logger.error({ err }, 'Failed to load saved bots');
    } finally {
      this.loadingBots = false;
      this.saveBotsImmediate();
    }
  }
}
