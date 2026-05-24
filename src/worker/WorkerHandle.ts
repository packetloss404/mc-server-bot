import { Worker } from 'worker_threads';
import path from 'path';
import { IPCChannel } from './IPCChannel';
import { LLMClient } from '../ai/LLMClient';
import { AffinityManager } from '../personality/AffinityManager';
import { ConversationManager } from '../personality/ConversationManager';
import { BlackboardManager } from '../voyager/BlackboardManager';
import { SharedWorldModel } from '../voyager/SharedWorldModel';
import { DifficultyBalancer } from '../voyager/DifficultyBalancer';
import { PlayerIntentModel } from '../voyager/PlayerIntentModel';
import { TraceRecord, TraceType } from '../voyager/DecisionTrace';
import { logger } from '../util/logger';

export interface WorkerBotData {
  botName: string;
  personality: string;
  mode: string;
  spawnLocation?: { x: number; y: number; z: number };
  /**
   * Stable small integer slot assigned by BotManager at spawn time.
   * Used to derive a deterministic prismarine-viewer port (3100 + slot)
   * so the same bot keeps the same iframe URL across restarts.
   */
  workerSlotIndex: number;
}

/**
 * Lifecycle of the worker thread, used to gate IPC traffic so concurrent
 * sendRequest() calls during a crash window fail fast instead of timing out
 * after 60s against a dead postMessage target.
 *
 *   IDLE ───start()──▶ RUNNING ──worker exit──▶ DEAD ──maybeRestart()──▶ RESTARTING
 *                         │                                                   │
 *                         └──terminate()──▶ STOPPING ──exit──▶ DEAD            └──start()──▶ RUNNING
 *
 * Only RUNNING accepts new requests. Any other state rejects synchronously.
 */
export type WorkerState = 'IDLE' | 'RUNNING' | 'STOPPING' | 'DEAD' | 'RESTARTING';

export class WorkerHandle {
  readonly botName: string;
  readonly personality: string;
  readonly mode: string;
  readonly spawnLocation?: { x: number; y: number; z: number };
  readonly workerSlotIndex: number;

  private worker: Worker | null = null;
  private ipc: IPCChannel | null = null;
  private intentionalShutdown = false;
  private crashCount = 0;
  private crashWindowStart = 0;
  private state: WorkerState = 'IDLE';

  // Cached state pushed by the worker
  lastStatus: any = null;
  lastDetailedStatus: any = null;
  lastDiagnostics: any = null;

  // Decision trace buffer (forwarded from worker)
  private traceBuffer: TraceRecord[] = [];
  private traceMaxSize = 500;
  private onTrace?: (record: TraceRecord) => void;
  private onReputationEvent?: (event: any) => void;
  private onDeath?: (event: { botName: string; position: { x: number; y: number; z: number } | null }) => void;
  private onPlayerJoined?: (playerName: string) => void;
  private onPlayerLeft?: (playerName: string) => void;
  private onImpersonation?: (info: { botName: string; reason: string; signal: string }) => void;

  // Shared managers for IPC routing
  private llmClient: LLMClient | null;
  private affinityManager: AffinityManager;
  private conversationManager: ConversationManager;
  private blackboardManager: BlackboardManager;
  private sharedWorldModel: SharedWorldModel;
  private difficultyBalancer: DifficultyBalancer | null;
  private playerIntentModel: PlayerIntentModel | null;
  private onSwarmDirective: (description: string, requestedBy: string) => void;
  /**
   * Optional resolver for a bot's town role. Wired by BotManager from the
   * TownManager. Returns the bot's currentRole or null when the bot isn't
   * a town resident. WorkerHandle caches the lookup for 60s to keep the
   * hot Voyager-claim path (~1 IPC per claim) cheap. Followup #40.
   */
  private resolveBotRole: ((botName: string) => string | null) | null = null;
  private botRoleCache: { value: string | null; expiresAt: number } | null = null;
  private static readonly ROLE_CACHE_TTL_MS = 60_000;

  constructor(
    data: WorkerBotData,
    llmClient: LLMClient | null,
    affinityManager: AffinityManager,
    conversationManager: ConversationManager,
    blackboardManager: BlackboardManager,
    sharedWorldModel: SharedWorldModel,
    onSwarmDirective: (description: string, requestedBy: string) => void,
    difficultyBalancer: DifficultyBalancer | null = null,
    playerIntentModel: PlayerIntentModel | null = null,
    resolveBotRole: ((botName: string) => string | null) | null = null,
  ) {
    this.botName = data.botName;
    this.personality = data.personality;
    this.mode = data.mode;
    this.spawnLocation = data.spawnLocation;
    this.workerSlotIndex = data.workerSlotIndex;
    this.llmClient = llmClient;
    this.affinityManager = affinityManager;
    this.conversationManager = conversationManager;
    this.blackboardManager = blackboardManager;
    this.sharedWorldModel = sharedWorldModel;
    this.difficultyBalancer = difficultyBalancer;
    this.playerIntentModel = playerIntentModel;
    this.onSwarmDirective = onSwarmDirective;
    this.resolveBotRole = resolveBotRole;

    // Provide a basic cached status while worker boots
    this.lastStatus = {
      name: data.botName,
      personality: data.personality,
      mode: data.mode,
      state: 'SPAWNING',
      position: data.spawnLocation || null,
    };
  }

  start(): void {
    const workerPath = path.join(__dirname, 'botWorker.js');
    this.worker = new Worker(workerPath, {
      workerData: {
        botName: this.botName,
        personality: this.personality,
        mode: this.mode,
        spawnLocation: this.spawnLocation,
        workerSlotIndex: this.workerSlotIndex,
      },
    });

    this.ipc = new IPCChannel(this.worker);
    this.state = 'RUNNING';
    this.setupIPC();
    this.setupWorkerEvents();

    logger.info({ bot: this.botName }, 'Worker thread started');
  }

  private setupIPC(): void {
    if (!this.ipc) return;

    // Handle requests from worker → main (LLM, blackboard, affinity, conversation)
    this.ipc.onRequest(async (type, args) => {
      return this.routeRequest(type, args);
    });

    // Handle notifications from worker
    this.ipc.onNotify((type, data) => {
      this.routeNotification(type, data);
    });
  }

  private async routeRequest(type: string, args: any[]): Promise<any> {
    // LLM
    if (type === 'llm.chat') {
      if (!this.llmClient) throw new Error('No LLM client available');
      return this.llmClient.chat(args[0], args[1], args[2]);
    }
    if (type === 'llm.generate') {
      if (!this.llmClient) throw new Error('No LLM client available');
      return this.llmClient.generate(args[0], args[1], args[2]);
    }
    if (type === 'llm.embed') {
      if (!this.llmClient?.embed) throw new Error('LLM client does not support embed');
      return this.llmClient.embed(args[0]);
    }

    // Blackboard
    if (type === 'blackboard.setSwarmGoal') return this.blackboardManager.setSwarmGoal(args[0], args[1], args[2]);
    if (type === 'blackboard.setBotGoal') return this.blackboardManager.setBotGoal(args[0], args[1]);
    if (type === 'blackboard.clearBotGoal') return this.blackboardManager.clearBotGoal(args[0]);
    if (type === 'blackboard.addTask') return this.blackboardManager.addTask(args[0], args[1], args[2]);
    if (type === 'blackboard.claimBestTask') return this.blackboardManager.claimBestTask(args[0], args[1], args[2], args[3], args[4]);
    if (type === 'blackboard.getBotRole') return this.getCachedBotRole(args[0]);
    if (type === 'blackboard.getState') return this.blackboardManager.getState();
    if (type === 'blackboard.getRecentMessages') return this.blackboardManager.getRecentMessages(args[0]);
    if (type === 'blackboard.getSwarmGoal') return this.blackboardManager.getSwarmGoal();
    if (type === 'blackboard.claimReservation') return this.blackboardManager.claimReservation(args[0], args[1], args[2], args[3], args[4]);
    if (type === 'blackboard.hasReservation') return this.blackboardManager.hasReservation(args[0], args[1], args[2]);
    if (type === 'blackboard.releaseStale') return this.blackboardManager.releaseStale(args[0]);
    if (type === 'blackboard.getSwarmRelevantTasks') return this.blackboardManager.getSwarmRelevantTasks(args[0]);
    if (type === 'blackboard.getBlockedTaskDescriptions') return [...this.blackboardManager.getBlockedTaskDescriptions(args[0])];
    if (type === 'blackboard.getRecentMessagesForBot') return this.blackboardManager.getRecentMessagesForBot(args[0], args[1]);

    // Affinity
    if (type === 'affinity.get') return this.affinityManager.get(args[0], args[1]);
    if (type === 'affinity.isHostile') return this.affinityManager.isHostile(args[0], args[1]);
    if (type === 'affinity.getAllForBot') return this.affinityManager.getAllForBot(args[0]);
    if (type === 'affinity.getAll') return this.affinityManager.getAll();

    // Conversation
    if (type === 'conversation.getHistory') return this.conversationManager.getHistory(args[0], args[1]);
    if (type === 'conversation.buildContentsArray') return this.conversationManager.buildContentsArray(args[0], args[1], args[2]);
    if (type === 'conversation.getAllConversations') return this.conversationManager.getAllConversations(args[0]);

    // DifficultyBalancer
    if (type === 'difficulty.getBotBehaviorModifiers') {
      if (!this.difficultyBalancer) {
        // Sensible neutral defaults if no balancer is wired in this deployment.
        return { taskCooldownMultiplier: 1.0, preferredTaskTypes: [], chatProbability: 0.4, helpRadius: 32 };
      }
      return this.difficultyBalancer.getBotBehaviorModifiers();
    }

    // PlayerIntentModel
    if (type === 'playerIntent.predictIntent') {
      if (!this.playerIntentModel) {
        return { intent: 'unknown', confidence: 0, evidence: [], suggestedBotResponse: '' };
      }
      return this.playerIntentModel.predictIntent(args[0]);
    }

    throw new Error(`Unknown IPC request type: ${type}`);
  }

  private routeNotification(type: string, data: any): void {
    // Status updates from worker
    if (type === 'status.update') {
      this.lastStatus = data.status;
      this.lastDetailedStatus = data.detailedStatus;
      this.lastDiagnostics = data.diagnostics;
      return;
    }

    // Swarm directive forwarding
    if (type === 'swarm.directive') {
      this.onSwarmDirective(data.description, data.requestedBy);
      return;
    }

    // Reputation event forwarding from worker
    if (type === 'reputation.recordEvent') {
      if (this.onReputationEvent) {
        try { this.onReputationEvent(data); }
        catch (err: any) { logger.error({ bot: this.botName, err: err.message }, 'Reputation event handler error'); }
      } else {
        logger.debug({ bot: this.botName }, 'Reputation event received but no listener set');
      }
      return;
    }

    // Bot death forwarding from worker
    if (type === 'bot.died') {
      if (this.onDeath) {
        try { this.onDeath(data); }
        catch (err: any) { logger.error({ bot: this.botName, err: err.message }, 'Death event handler error'); }
      }
      return;
    }

    // Impersonation (duplicate-login kick) forwarding from worker.
    if (type === 'security.impersonation') {
      if (this.onImpersonation) {
        try { this.onImpersonation(data); }
        catch (err: any) { logger.error({ bot: this.botName, err: err.message }, 'Impersonation event handler error'); }
      }
      return;
    }

    // Player join/leave forwarding from worker (one event per bot that saw it;
    // BotManager dedupes across the fleet and filters out our own bot names).
    if (type === 'player.joined') {
      if (this.onPlayerJoined && data?.playerName) {
        try { this.onPlayerJoined(data.playerName); }
        catch (err: any) { logger.error({ bot: this.botName, err: err.message }, 'PlayerJoined handler error'); }
      }
      return;
    }
    if (type === 'player.left') {
      if (this.onPlayerLeft && data?.playerName) {
        try { this.onPlayerLeft(data.playerName); }
        catch (err: any) { logger.error({ bot: this.botName, err: err.message }, 'PlayerLeft handler error'); }
      }
      return;
    }

    // Decision trace forwarding from worker
    if (type === 'decision.trace') {
      const record = data as TraceRecord;
      this.traceBuffer.push(record);
      if (this.traceBuffer.length > this.traceMaxSize) {
        this.traceBuffer.shift();
      }
      this.onTrace?.(record);
      return;
    }

    // Fire-and-forget blackboard operations
    if (type === 'blackboard.completeTask') { this.blackboardManager.completeTask(data[0], data[1]); return; }
    if (type === 'blackboard.blockTask') { this.blackboardManager.blockTask(data[0], data[1], data[2]); return; }
    if (type === 'blackboard.postMessage') { this.blackboardManager.postMessage(data[0], data[1], data[2]); return; }
    if (type === 'blackboard.releaseReservationsForBot') { this.blackboardManager.releaseReservationsForBot(data[0], data[1]); return; }

    // Fire-and-forget affinity operations
    if (type === 'affinity.onPositiveChat') { this.affinityManager.onPositiveChat(data[0], data[1]); return; }
    if (type === 'affinity.onNegativeSentiment') { this.affinityManager.onNegativeSentiment(data[0], data[1]); return; }
    if (type === 'affinity.onHit') { this.affinityManager.onHit(data[0], data[1]); return; }
    if (type === 'affinity.onGift') { this.affinityManager.onGift(data[0], data[1]); return; }
    if (type === 'affinity.clearBot') { this.affinityManager.clearBot(data[0]); return; }

    // Fire-and-forget conversation operations
    if (type === 'conversation.addPlayerMessage') { this.conversationManager.addPlayerMessage(data[0], data[1], data[2]); return; }
    if (type === 'conversation.addBotResponse') { this.conversationManager.addBotResponse(data[0], data[1], data[2]); return; }
    if (type === 'conversation.clearBot') { this.conversationManager.clearBot(data[0]); return; }

    // Fire-and-forget SharedWorldModel updates
    if (type === 'sharedWorld.reportResource') { this.sharedWorldModel.reportResource(data[0], data[1]); return; }
    if (type === 'sharedWorld.reportThreat') { this.sharedWorldModel.reportThreat(data[0], data[1]); return; }
    if (type === 'sharedWorld.updateBotState') { this.sharedWorldModel.updateBotState(data[0]); return; }
    if (type === 'sharedWorld.markChunkExplored') { this.sharedWorldModel.markChunkExplored(data[0], data[1]); return; }
    if (type === 'sharedWorld.updateServerState') { this.sharedWorldModel.updateServerState(data[0], data[1]); return; }
  }

  private setupWorkerEvents(): void {
    if (!this.worker) return;

    this.worker.on('error', (err) => {
      logger.error({ bot: this.botName, err: err.message }, 'Worker thread error');
    });

    this.worker.on('exit', (code) => {
      logger.info({ bot: this.botName, code, intentional: this.intentionalShutdown }, 'Worker thread exited');
      // Flip to DEAD before destroying IPC so any concurrent sendRequest()
      // that races between the worker dying and us seeing the exit event
      // will reject through the gate rather than posting to a dead port.
      this.state = 'DEAD';
      this.ipc?.destroy();
      this.ipc = null;
      this.worker = null;

      if (!this.intentionalShutdown) {
        this.maybeRestart();
      }
    });
  }

  private maybeRestart(): void {
    const now = Date.now();
    if (now - this.crashWindowStart > 60000) {
      this.crashCount = 0;
      this.crashWindowStart = now;
    }
    this.crashCount++;

    if (this.crashCount > 3) {
      logger.error({ bot: this.botName, crashes: this.crashCount }, 'Worker crashed too many times, not restarting');
      this.lastStatus = { ...this.lastStatus, state: 'DISCONNECTED' };
      // Leave state as DEAD so further requests fail fast — there is no
      // worker coming back to service them.
      return;
    }

    // Mark RESTARTING during the cooldown window so sendRequest() still
    // rejects fast instead of timing out while we wait for the restart.
    this.state = 'RESTARTING';
    const delay = 5000 * this.crashCount;
    logger.warn({ bot: this.botName, crashCount: this.crashCount, delayMs: delay }, 'Scheduling worker restart');
    setTimeout(() => {
      if (!this.intentionalShutdown) {
        this.start();
      }
    }, delay);
  }

  /**
   * Followup #40 — resolve the bot's town role with a 60s in-memory cache.
   * Called from the worker's claimBestTask path, so this runs on every
   * Voyager tick when a task is up for grabs. Without the cache that
   * would be one TownManager DB query per claim — cheap individually but
   * pointlessly noisy.
   *
   * Returns null when the resolver isn't wired or the bot isn't a town
   * resident; callers (BlackboardManager.scoreTaskEnhanced) treat null
   * as "no role boost" and behave exactly like before.
   */
  private getCachedBotRole(botName: string): string | null {
    const target = botName ?? this.botName;
    // Cache is keyed implicitly by `this.botName` — a WorkerHandle is per-bot.
    // If a caller ever passes a different name, fall through to the resolver
    // without caching to avoid surprising cross-bot results.
    if (target === this.botName) {
      const now = Date.now();
      if (this.botRoleCache && this.botRoleCache.expiresAt > now) {
        return this.botRoleCache.value;
      }
      let value: string | null = null;
      if (this.resolveBotRole) {
        try { value = this.resolveBotRole(target); } catch { value = null; }
      }
      this.botRoleCache = { value, expiresAt: now + WorkerHandle.ROLE_CACHE_TTL_MS };
      return value;
    }
    if (!this.resolveBotRole) return null;
    try { return this.resolveBotRole(target); } catch { return null; }
  }

  /** Send a command to the worker */
  sendCommand(type: string, data: any = {}): void {
    this.ipc?.command(type, data);
  }

  /**
   * Fire-and-forget runtime config patch propagation.
   *
   * The main thread's PATCH /api/config/:section handler has already validated
   * and persisted the new values; this just nudges each live worker so its
   * captured `this.config[section]` picks up the change without a restart.
   *
   * Safe to call when the worker is dead or disconnected: a missing IPC
   * channel logs a debug message and returns rather than throwing, so the
   * PATCH handler can broadcast indiscriminately across `getAllWorkers()`.
   */
  postConfigPatch(section: string, values: Record<string, unknown>): void {
    if (!this.ipc || !this.worker) {
      logger.debug(
        { bot: this.botName, section },
        'postConfigPatch skipped: worker not running',
      );
      return;
    }
    try {
      this.ipc.command('config:patch', { section, values });
    } catch (err: any) {
      logger.warn(
        { bot: this.botName, section, err: err?.message },
        'postConfigPatch failed to dispatch',
      );
    }
  }

  /**
   * Send a request to the worker and await response.
   *
   * Gated on `state === 'RUNNING'`: during the (potentially multi-second)
   * window between worker exit and the next worker becoming ready, we reject
   * synchronously so callers don't accumulate 60s-timeout promises against a
   * dead postMessage target. Callers that want to tolerate a restart should
   * retry on this error after `isAlive()` flips back to true.
   */
  async sendRequest(type: string, args: any[] = []): Promise<any> {
    if (this.state !== 'RUNNING' || !this.ipc) {
      throw new Error(`Worker not running (state=${this.state}, request='${type}')`);
    }
    return this.ipc.request(type, args);
  }

  /** Current lifecycle state — exposed primarily for diagnostics/testing. */
  getState(): WorkerState {
    return this.state;
  }

  // ── Build coordinator helpers (forward to worker via IPC) ──

  /** Send a chat / command message through the bot. */
  chat(message: string): void {
    this.sendCommand('chat', { message });
  }

  /** Set the bot's high-level state (e.g. BUILDING, IDLE). */
  setBotState(state: string): void {
    this.sendCommand('setBotState', { state });
  }

  /** Clear an impersonation quarantine and reconnect the bot. */
  releaseQuarantine(): void {
    this.sendCommand('releaseQuarantine', {});
  }

  pauseVoyager(reason?: string): void {
    this.sendCommand('pauseVoyager', { reason });
  }

  resumeVoyager(): void {
    this.sendCommand('resumeVoyager', {});
  }

  stopMovement(): void {
    this.sendCommand('stopMovement', {});
  }

  /** Returns true if the worker thinks the underlying mineflayer bot is connected and spawned. */
  async isBotConnected(): Promise<boolean> {
    if (!this.ipc) return false;
    try {
      return await this.sendRequest('isBotConnected', []);
    } catch {
      return false;
    }
  }

  async getBotVersion(): Promise<string | null> {
    if (!this.ipc) return null;
    try {
      return await this.sendRequest('getBotVersion', []);
    } catch {
      return null;
    }
  }

  /**
   * Get the prismarine-viewer HTTP port for this bot. The worker lazy-mounts
   * the viewer on first request — the WebGL/Express cost is only paid when
   * someone actually opens the View tab.
   *
   * Returns null if the bot isn't connected yet, the viewer failed to start
   * (e.g. native canvas/three dep issue), or the worker isn't running.
   */
  async getViewerPort(): Promise<number | null> {
    if (!this.ipc) return null;
    try {
      const port = await this.sendRequest('getViewerPort', []);
      return typeof port === 'number' ? port : null;
    } catch {
      return null;
    }
  }

  async getTerrainGrid(
    cx: number, cz: number, radius: number, step: number,
    yTop = 120, yBottom = -60,
  ): Promise<string[] | null> {
    if (!this.ipc) return null;
    try {
      return await this.sendRequest('getTerrainGrid', [cx, cz, radius, step, yTop, yBottom]);
    } catch {
      return null;
    }
  }

  async getPlayers(): Promise<Array<{ name: string; position: { x: number; y: number; z: number } | null; isOnline: boolean }>> {
    if (!this.ipc) return [];
    try {
      return await this.sendRequest('getPlayers', []);
    } catch {
      return [];
    }
  }

  async getBlockAt(x: number, y: number, z: number): Promise<{ name: string } | null> {
    if (!this.ipc) return null;
    try {
      return await this.sendRequest('getBlockAt', [x, y, z]);
    } catch {
      return null;
    }
  }

  getCachedStatus(): any {
    return this.lastStatus;
  }

  getCachedDetailedStatus(): any {
    return this.lastDetailedStatus;
  }

  getCachedDiagnostics(): any {
    return this.lastDiagnostics;
  }

  /** Get recent decision traces, optionally filtered by type. Newest first. */
  getDecisionTraces(limit = 50, type?: TraceType): TraceRecord[] {
    let records = this.traceBuffer;
    if (type) {
      records = records.filter((r) => r.type === type);
    }
    return records.slice(-limit).reverse();
  }

  /** Register a callback for real-time trace events (used by Socket.IO). */
  setTraceListener(fn: (record: TraceRecord) => void): void {
    this.onTrace = fn;
  }

  /** Register a callback for reputation events from the worker. */
  setReputationListener(fn: (event: any) => void): void {
    this.onReputationEvent = fn;
  }

  /** Register a callback for death events from the worker. */
  setDeathListener(fn: (event: { botName: string; position: { x: number; y: number; z: number } | null }) => void): void {
    this.onDeath = fn;
  }

  /** Register a callback for impersonation (duplicate-login) events from the worker. */
  setImpersonationListener(fn: (info: { botName: string; reason: string; signal: string }) => void): void {
    this.onImpersonation = fn;
  }

  /** Register callbacks for player join/leave events seen by this worker's bot. */
  setPlayerPresenceListeners(
    onJoin: (playerName: string) => void,
    onLeave: (playerName: string) => void,
  ): void {
    this.onPlayerJoined = onJoin;
    this.onPlayerLeft = onLeave;
  }

  isAlive(): boolean {
    return this.worker !== null;
  }

  async terminate(): Promise<void> {
    this.intentionalShutdown = true;
    if (this.worker) {
      // Mark STOPPING before posting the disconnect so any in-flight call
      // sites see a non-RUNNING state and bail out of sendRequest() early.
      this.state = 'STOPPING';
      this.sendCommand('disconnect');
      // Wait for graceful exit, then force terminate
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.worker?.terminate();
          resolve();
        }, 5000);
        this.worker?.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    this.state = 'DEAD';
    this.ipc?.destroy();
    this.ipc = null;
    this.worker = null;
  }
}
