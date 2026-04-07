import { Worker } from 'worker_threads';
import path from 'path';
import { IPCChannel } from './IPCChannel';
import { LLMClient } from '../ai/LLMClient';
import { AffinityManager } from '../personality/AffinityManager';
import { ConversationManager } from '../personality/ConversationManager';
import { BlackboardManager } from '../voyager/BlackboardManager';
import { SharedWorldModel } from '../voyager/SharedWorldModel';
import { TraceRecord, TraceType } from '../voyager/DecisionTrace';
import { logger } from '../util/logger';

export interface WorkerBotData {
  botName: string;
  personality: string;
  mode: string;
  spawnLocation?: { x: number; y: number; z: number };
}

export class WorkerHandle {
  readonly botName: string;
  readonly personality: string;
  readonly mode: string;
  readonly spawnLocation?: { x: number; y: number; z: number };

  private worker: Worker | null = null;
  private ipc: IPCChannel | null = null;
  private intentionalShutdown = false;
  private crashCount = 0;
  private crashWindowStart = 0;

  // Cached state pushed by the worker
  lastStatus: any = null;
  lastDetailedStatus: any = null;
  lastDiagnostics: any = null;

  // Decision trace buffer (forwarded from worker)
  private traceBuffer: TraceRecord[] = [];
  private traceMaxSize = 500;
  private onTrace?: (record: TraceRecord) => void;
  private onReputationEvent?: (event: any) => void;

  // Shared managers for IPC routing
  private llmClient: LLMClient | null;
  private affinityManager: AffinityManager;
  private conversationManager: ConversationManager;
  private blackboardManager: BlackboardManager;
  private sharedWorldModel: SharedWorldModel;
  private onSwarmDirective: (description: string, requestedBy: string) => void;

  constructor(
    data: WorkerBotData,
    llmClient: LLMClient | null,
    affinityManager: AffinityManager,
    conversationManager: ConversationManager,
    blackboardManager: BlackboardManager,
    sharedWorldModel: SharedWorldModel,
    onSwarmDirective: (description: string, requestedBy: string) => void,
  ) {
    this.botName = data.botName;
    this.personality = data.personality;
    this.mode = data.mode;
    this.spawnLocation = data.spawnLocation;
    this.llmClient = llmClient;
    this.affinityManager = affinityManager;
    this.conversationManager = conversationManager;
    this.blackboardManager = blackboardManager;
    this.sharedWorldModel = sharedWorldModel;
    this.onSwarmDirective = onSwarmDirective;

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
      },
    });

    this.ipc = new IPCChannel(this.worker);
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
    if (type === 'blackboard.claimBestTask') return this.blackboardManager.claimBestTask(args[0], args[1], args[2], args[3]);
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
      return;
    }

    const delay = 5000 * this.crashCount;
    logger.warn({ bot: this.botName, crashCount: this.crashCount, delayMs: delay }, 'Scheduling worker restart');
    setTimeout(() => {
      if (!this.intentionalShutdown) {
        this.start();
      }
    }, delay);
  }

  /** Send a command to the worker */
  sendCommand(type: string, data: any = {}): void {
    this.ipc?.command(type, data);
  }

  /** Send a request to the worker and await response */
  async sendRequest(type: string, args: any[] = []): Promise<any> {
    if (!this.ipc) throw new Error('Worker not running');
    return this.ipc.request(type, args);
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

  isAlive(): boolean {
    return this.worker !== null;
  }

  async terminate(): Promise<void> {
    this.intentionalShutdown = true;
    if (this.worker) {
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
    this.ipc?.destroy();
    this.ipc = null;
    this.worker = null;
  }
}
