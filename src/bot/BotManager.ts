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
import { CultureManager } from '../social/CultureManager';
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
import { RuleStore, TownRule } from '../town/RuleStore';
import { ImpersonationMonitor, ImpersonationIncident, ImpersonationInput } from '../security/ImpersonationMonitor';

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
  /** Project Sid P3-B — authoritative cross-worker cultural-meme registry.
   *  Owned by the main thread (like AffinityManager); workers reach it via
   *  CultureProxy over IPC. Only exercised when `config.social.culture` is on. */
  private cultureManager: CultureManager;
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
  /** Project Sid P2-A — standing mayor rules. Populated by the decree handler
   *  when `config.governance.enabled`; consulted by BlackboardManager scoring
   *  (also gated on the flag). */
  private ruleStore: RuleStore;
  private impersonationMonitor: ImpersonationMonitor;
  /** Set by the server layer (index.ts) to surface impersonation incidents on
   *  the dashboard activity feed + a Socket.IO alert. Optional so BotManager
   *  works headless in tests. */
  onImpersonationAlert?: (incident: ImpersonationIncident) => void;
  private watchdogInterval: NodeJS.Timeout | null = null;
  private nextStaggerAt = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private spawnListeners: Array<(handle: WorkerHandle) => void> = [];
  /** Fleet-wide dedup for playerJoined/playerLeft events. Every bot sees the
   *  same join packet, so without this we'd log N times (once per online bot).
   *  Key is `${event}:${lowerName}`; value is the last-fire timestamp. */
  private playerEventLastFireAt: Map<string, number> = new Map();
  private static readonly PLAYER_EVENT_DEDUP_MS = 5_000;

  constructor(config: Config, llmClient: LLMClient | null) {
    this.config = config;
    this.dataPath = path.join(process.cwd(), 'data', 'bots.json');
    this.llmClient = llmClient;
    this.affinityManager = new AffinityManager(config.affinity, path.join(process.cwd(), 'data'));
    this.conversationManager = new ConversationManager();
    this.socialMemory = new SocialMemory(path.join(process.cwd(), 'data'));
    this.botComms = BotComms.getInstance();
    this.cultureManager = new CultureManager(path.join(process.cwd(), 'data'));
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
    this.ruleStore = new RuleStore(path.join(process.cwd(), 'data'));
    this.impersonationMonitor = new ImpersonationMonitor();

    // Project Sid P2-A — wire the standing-rule resolver into BlackboardManager
    // the same way the role resolver is injected (a per-bot closure that walks
    // towns/residents). Gated entirely on `config.governance.enabled`: when the
    // flag is off the resolver returns [] for every bot, so scoreTaskEnhanced
    // applies no rule boost and scores are identical to today.
    this.blackboardManager.setActiveRulesForBotResolver(
      (botName: string): TownRule[] => this.resolveActiveRulesForBot(botName),
    );
  }

  /** Project Sid P2-A — accessor for the standing-rule store (used by the
   *  mayor/decree handler and GET /api/towns/:id/rules). */
  getRuleStore(): RuleStore { return this.ruleStore; }

  /** Accessor for the runtime config (used by town-level governance wiring
   *  to read the `governance.enabled` flag). */
  getConfig(): Config { return this.config; }

  /**
   * Project Sid P2-B — resolve a bot's ACTIVE town rules across the worker
   * boundary. Mirrors the role resolver: walks every town (small N) for a
   * resident row whose botName matches and returns that town's active rules.
   * Gated entirely on `config.governance.enabled`: when the flag is off this
   * returns [] for every bot, so VoyagerLoop injects no rule text into any
   * prompt and there's zero token cost. Returns [] for non-resident bots and
   * on any TownManager error (rule injection is additive).
   */
  private resolveActiveRulesForBot(botName: string): TownRule[] {
    if (!this.config.governance?.enabled) return [];
    try {
      const towns = this.townManager.listTowns();
      for (const town of towns) {
        const residents = this.townManager.listResidents(town.id);
        const hit = residents.find(
          (r) => r.botName.toLowerCase() === botName.toLowerCase(),
        );
        if (hit) return this.ruleStore.getActiveRules(town.id);
      }
    } catch {
      /* swallow — rule injection is additive */
    }
    return [];
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
      // Project Sid P2-B — resolver so VoyagerLoop can fetch this bot's
      // active town rules across the worker boundary and inject them into
      // the resident task-proposal prompt. Gated on governance.enabled
      // (returns [] when off ⇒ no token cost). WorkerHandle caches for 60s.
      (botName: string): TownRule[] => this.resolveActiveRulesForBot(botName),
      // Project Sid P3-B — the cross-worker meme registry + a per-bot town
      // resolver so adoptions are tagged by town (powering the per-town meme
      // curves in GET /api/culture). Only consulted when `config.social.culture`
      // is on; the worker never even builds a CultureProxy when the flag is off.
      this.cultureManager,
      (botName: string): string => this.resolveTownIdForBot(botName),
      // Project Sid P3 (SHOULD-FIX #1) — the AUTHORITATIVE inter-bot message
      // relay. This is the SAME main-thread BotComms the dashboard API
      // (GET/POST /api/bots/:name/messages) already reads/writes, so a message
      // a bot's worker broadcasts now fans out to OTHER bots' worker inboxes
      // through it. The worker only reaches it (via BotCommsProxy) when
      // `social.botAffinity` or `social.culture` is on; with both off no proxy
      // is built and this is never exercised.
      this.botComms,
    );

    // Wire reputation listener immediately so it's ready before the worker sends events
    handle.setReputationListener((event) => {
      this.botReputation.recordEvent(event);
    });

    // Real-player presence tracking. The worker forwards every playerJoined/Left
    // its bot sees; we drop anything matching one of our bot names and dedupe
    // across the fleet so only the first sighting in a 5s window logs.
    handle.setPlayerPresenceListeners(
      (playerName) => this.handleFleetPlayerEvent('join', playerName),
      (playerName) => this.handleFleetPlayerEvent('leave', playerName),
    );

    // Impersonation: the worker reports when its bot was kicked by a
    // duplicate-login (someone logged in under this bot's name).
    handle.setImpersonationListener((info) => this.handleImpersonation(info));

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

  /**
   * Receives playerJoined/playerLeft from any worker. Drops events for our own
   * bots (they show up in every bot's tab list) and dedupes across the fleet
   * so one real-player join produces one log line, not one per bot.
   */
  private handleFleetPlayerEvent(event: 'join' | 'leave', playerName: string): void {
    if (!playerName) return;
    const lower = playerName.toLowerCase();
    const ownWorker = this.workers.get(lower);
    if (ownWorker) {
      // Normally a roster name in the tab list is just our own bot. But if OUR
      // bot of that name is offline (we were kicked / quarantined) and a player
      // with that name is online, that's an impostor wearing our identity —
      // corroborating the duplicate-login signal (or catching a server whose
      // kick message we didn't pattern-match). Only fire on join; offline =
      // cached state DISCONNECTED/QUARANTINED, so a healthy bot won't trip it.
      const detectionEnabled = this.config.security?.impersonationDetection !== false;
      const state = ownWorker.getCachedStatus()?.state;
      if (event === 'join' && detectionEnabled && (state === 'QUARANTINED' || state === 'DISCONNECTED')) {
        this.handleImpersonation({
          botName: ownWorker.botName,
          reason: `Roster name '${ownWorker.botName}' seen online while our bot is ${state}`,
          signal: 'ghost-name',
        });
      }
      return; // either way, don't treat a bot name as a real-player presence
    }

    const dedupKey = `${event}:${lower}`;
    const now = Date.now();
    const last = this.playerEventLastFireAt.get(dedupKey) ?? 0;
    if (now - last < BotManager.PLAYER_EVENT_DEDUP_MS) return;
    this.playerEventLastFireAt.set(dedupKey, now);

    if (event === 'join') {
      logger.info({ player: playerName }, 'Real player joined server');
      try { this.playerPresenceTracker.recordJoin(playerName); }
      catch (err: any) { logger.warn({ player: playerName, err: err?.message }, 'recordJoin failed'); }
    } else {
      logger.info({ player: playerName }, 'Real player left server');
      try { this.playerPresenceTracker.recordLeave(playerName); }
      catch (err: any) { logger.warn({ player: playerName, err: err?.message }, 'recordLeave failed'); }
    }
  }

  /**
   * Central response to an impersonation signal. Dedupes via
   * ImpersonationMonitor, logs, and on a NEW incident fans out the three alert
   * channels: dashboard+log (via onImpersonationAlert → EventLog/Socket.IO),
   * in-game chat broadcast (config-gated), and an outbound webhook (env-gated).
   * The affected bot has already quarantined itself in its worker; this is the
   * operator-facing alerting + fleet response.
   */
  handleImpersonation(info: { botName: string; reason: string; signal: string }): void {
    // `signal` crosses the worker→main IPC boundary as a plain string; narrow
    // it back to the union (anything unexpected is treated as duplicate-login).
    const signal: ImpersonationInput['signal'] = info.signal === 'ghost-name' ? 'ghost-name' : 'duplicate-login';
    const { isNew, incident } = this.impersonationMonitor.record({ botName: info.botName, reason: info.reason, signal });
    logger.warn(
      { bot: info.botName, signal: info.signal, count: incident.count, reason: info.reason },
      'Impersonation detected',
    );

    // Always surface to the dashboard/log channel (it dedupes visually by bot).
    try { this.onImpersonationAlert?.(incident); }
    catch (err: any) { logger.warn({ bot: info.botName, err: err?.message }, 'onImpersonationAlert hook failed'); }

    if (!isNew) return; // noisy channels only fire on a fresh incident

    // In-game chat broadcast (config-gated). Pick any currently-connected bot
    // to announce it. Note: this is visible to the attacker by design choice.
    if (this.config.security?.broadcastInGame) {
      const messenger = this.getAllWorkers().find((w) => {
        const s = w.getCachedStatus()?.state;
        return s && s !== 'QUARANTINED' && s !== 'DISCONNECTED' && s !== 'SPAWNING';
      });
      if (messenger) {
        try { messenger.chat(`[security] Impersonation detected: someone is using ${info.botName}'s name.`); }
        catch (err: any) { logger.debug({ err: err?.message }, 'in-game impersonation broadcast failed'); }
      }
    }

    // Outbound webhook (Discord-compatible), env-gated, fire-and-forget.
    void this.postImpersonationWebhook(incident);
  }

  /**
   * POST the incident to IMPERSONATION_ALERT_WEBHOOK if set. Discord-compatible
   * `{ content }` payload; failures are swallowed so alerting never blocks or
   * crashes detection.
   */
  private async postImpersonationWebhook(incident: ImpersonationIncident): Promise<void> {
    const url = process.env.IMPERSONATION_ALERT_WEBHOOK;
    if (!url) return;
    const content =
      `🚨 **Impersonation detected** on the Minecraft server\n` +
      `Bot: \`${incident.botName}\` — signal: \`${incident.signal}\`\n` +
      `Reason: ${incident.reason}\n` +
      `The bot has been quarantined (auto-reconnect disabled).`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch (err: any) {
      logger.warn({ bot: incident.botName, err: err?.message }, 'Impersonation webhook POST failed');
    }
  }

  getImpersonationMonitor(): ImpersonationMonitor {
    return this.impersonationMonitor;
  }

  async removeAllBots(): Promise<number> {
    const count = this.workers.size;
    const names = [...this.workers.keys()];

    for (const name of names) {
      await this.removeBot(name);
    }

    return count;
  }

  /**
   * Shutdown path: terminate every worker thread cleanly without deleting
   * them from the in-memory map. This preserves bots.json across restarts —
   * the old behavior (calling removeAllBots in the SIGTERM handler) had each
   * removeBot save an empty bots.json, so the next boot loaded zero bots.
   * Callers should invoke this AFTER any final saveBotsImmediate flush.
   */
  async terminateAllWorkers(): Promise<number> {
    const handles = [...this.workers.values()];
    await Promise.all(
      handles.map(async (h) => {
        try {
          await h.terminate();
        } catch (err) {
          logger.warn({ bot: h.botName, err: (err as any)?.message }, 'Worker terminate failed during shutdown');
        }
      }),
    );
    return handles.length;
  }

  /** Flush all pending debounced writes across every data manager. */
  shutdownPersistence(): void {
    this.affinityManager.shutdown();
    this.socialMemory.shutdown();
    this.blackboardManager.shutdown();
    if (typeof (this.cultureManager as any).shutdown === 'function') (this.cultureManager as any).shutdown();
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

  /** Project Sid P3-B — accessor for the cultural-meme registry (used by
   *  GET /api/culture). Always returns the registry; it stays empty unless
   *  `config.social.culture` is on and bots start adopting memes. */
  getCultureManager(): CultureManager {
    return this.cultureManager;
  }

  /**
   * Project Sid P3-B — resolve a bot's town id so meme adoptions can be tagged
   * by town (per-town meme curves). Walks every town (small N) for a resident
   * row whose botName matches; returns '' for non-residents or on any error.
   */
  private resolveTownIdForBot(botName: string): string {
    try {
      const towns = this.townManager.listTowns();
      for (const town of towns) {
        const residents = this.townManager.listResidents(town.id);
        if (residents.some((r) => r.botName.toLowerCase() === botName.toLowerCase())) {
          return town.id;
        }
      }
    } catch {
      /* swallow — town tagging is additive */
    }
    return '';
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

  /** Start a watchdog that recovers disconnected / zombie / wedged bots. Runs
   *  every 30s so detection latency is bounded to ~30s + the staleness threshold
   *  (was 60s, which on top of the thresholds left a frozen bot dead for minutes). */
  startWatchdog(): void {
    if (this.watchdogInterval) return;
    this.watchdogInterval = setInterval(() => this.watchdogTick(), 30_000);
    logger.info('Bot watchdog started (30s interval)');
  }

  stopWatchdog(): void {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
  }

  /** Inbound-packet age (ms) beyond which a still-"connected" bot is treated as a
   *  zombie socket. Vanilla/Paper send keep_alive ~every 15s, so 60s (≈4 missed)
   *  will not false-positive on a live but quiet connection. */
  private static ZOMBIE_INBOUND_AGE_MS = 60_000;
  /** Gap (ms) since the last worker heartbeat beyond which the worker event loop
   *  is considered wedged. The worker force-posts every <=30s, so 90s = 3 misses. */
  private static WEDGED_WORKER_MS = 90_000;

  private watchdogTick(): void {
    const now = Date.now();
    for (const handle of this.workers.values()) {
      const status = handle.getCachedStatus();

      // (1) Clean disconnect: 'end'/'kicked' fired and set DISCONNECTED. The
      // in-worker scheduleReconnect usually handles this; the command is a backstop.
      if (status?.state === 'DISCONNECTED') {
        logger.info({ bot: handle.botName }, 'Watchdog: reconnecting disconnected worker');
        handle.sendCommand('reconnect', {});
        continue;
      }

      // (3) Wedged worker: event loop blocked, no heartbeats. Can't process a
      // 'reconnect' IPC — must terminate+restart. Checked before the zombie-socket
      // branch because a wedged worker also produces a stale inboundAgeMs, and the
      // restart is the stronger remedy. Skip until the first heartbeat has arrived.
      if (handle.lastStatusReceivedAt > 0 && now - handle.lastStatusReceivedAt > BotManager.WEDGED_WORKER_MS) {
        logger.error(
          { bot: handle.botName, sinceHeartbeatMs: now - handle.lastStatusReceivedAt },
          'Watchdog: worker heartbeat stale — terminating and restarting wedged worker',
        );
        void handle.forceRestart();
        continue;
      }

      // (2) Zombie socket: worker loop is alive (heartbeats flowing) but no inbound
      // MC traffic — half-open/CLOSE-WAIT whose 'end' never fired. Force a reconnect.
      const inboundAgeMs = status?.inboundAgeMs;
      if (typeof inboundAgeMs === 'number' && inboundAgeMs > BotManager.ZOMBIE_INBOUND_AGE_MS) {
        logger.warn(
          { bot: handle.botName, inboundAgeMs },
          'Watchdog: stale inbound socket (zombie) — forcing reconnect',
        );
        handle.sendCommand('reconnect', {});
        continue;
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
