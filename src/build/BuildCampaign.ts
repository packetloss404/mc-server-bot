import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { BuildCoordinator, BuildJob } from './BuildCoordinator';
import { selectCrew } from './CrewSelector';
import { EventLog } from '../server/EventLog';
import { logger } from '../util/logger';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import { CAMPAIGN_EVENTS } from '../control/CommandTypes';

// ── Interfaces ──────────────────────────────────────────────

export type CampaignStructureStatus =
  | 'pending'
  | 'building'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type CampaignStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused';

export interface CampaignStructure {
  id: string;
  schematicFile: string;
  origin: { x: number; y: number; z: number };
  /** Hint for how many bots to assign — actual count clamped by available pool. */
  botCountHint?: number;
  /** Filled in when this structure starts building */
  buildJobId?: string;
  status: CampaignStructureStatus;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface Campaign {
  id: string;
  name: string;
  structures: CampaignStructure[];
  status: CampaignStatus;
  createdAt: number;
  updatedAt: number;
  /** Run structures in parallel up to this many at once. Default 1. */
  maxParallel?: number;
  /** If true, dynamically spawn new bots when no idle bots are available. */
  autoSpawn?: boolean;
  /** Personality to use when autoSpawn fires. Default 'farmer'. */
  spawnPersonality?: string;
  /** If true, despawn campaign-spawned bots after the campaign completes. */
  cleanupBots?: boolean;
  /** Names of any bots spawned by this campaign — tracked for cleanup. */
  spawnedBotNames?: string[];
}

export interface CreateCampaignInput {
  name: string;
  structures: Array<Omit<CampaignStructure, 'id' | 'status' | 'buildJobId' | 'startedAt' | 'completedAt' | 'error'>>;
  maxParallel?: number;
  autoSpawn?: boolean;
  spawnPersonality?: string;
  cleanupBots?: boolean;
}

// ── Campaign Manager ───────────────────────────────────────

const DEFAULT_MAX_PARALLEL = 1;
const DEFAULT_SPAWN_PERSONALITY = 'farmer';
const DEFAULT_BOT_COUNT_HINT = 2;
const NO_CREW_RETRY_MS = 30_000;
const SPAWN_WAIT_MS = 5_000;
const PERSIST_DEBOUNCE_MS = 2_000;

export class CampaignManager {
  private botManager: BotManager;
  private buildCoordinator: BuildCoordinator;
  private io: SocketIOServer;
  private eventLog: EventLog;
  private campaigns: Map<string, Campaign> = new Map();
  private persistPath: string;
  private persistTimer: NodeJS.Timeout | null = null;
  /** Deferred retry timers per campaign (when no idle bots are available). */
  private retryTimers: Map<string, NodeJS.Timeout> = new Map();
  /** Whether the dispatch loop for a campaign is already running. */
  private dispatching: Set<string> = new Set();
  /** Listener for build:completed events that routes outcomes to campaigns. */
  private buildCompletedListener: ((job: BuildJob & { error?: string }) => void) | null = null;

  constructor(
    botManager: BotManager,
    buildCoordinator: BuildCoordinator,
    io: SocketIOServer,
    eventLog: EventLog,
  ) {
    this.botManager = botManager;
    this.buildCoordinator = buildCoordinator;
    this.io = io;
    this.eventLog = eventLog;
    this.persistPath = path.join(process.cwd(), 'data', 'campaigns.json');
    this.loadPersisted();
    this.installBuildListener();
  }

  // ── Persistence ────────────────────────────────────────

  private loadPersisted(): void {
    try {
      if (!fs.existsSync(this.persistPath)) return;
      const raw = fs.readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.campaigns)) return;
      for (const c of data.campaigns as Campaign[]) {
        this.campaigns.set(c.id, c);
      }
      logger.info({ count: data.campaigns.length }, 'Loaded persisted campaigns');
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to load persisted campaigns');
    }
  }

  private persist(): void {
    try {
      atomicWriteJsonSync(this.persistPath, {
        campaigns: [...this.campaigns.values()],
      });
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to persist campaigns');
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Flush pending writes on shutdown. */
  shutdown(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    this.persist();
  }

  // ── Socket listener wiring ─────────────────────────────

  private installBuildListener(): void {
    // `this.io` is a Socket.IO server. BuildCoordinator calls `io.emit('build:completed', job)`
    // which fans out to clients. To observe server-side, we listen on the underlying
    // emitter via a thin wrapper: we monkey-hook io.emit.
    //
    // Rather than patch io, the simpler route is to poll via a dedicated listener: we
    // register an intercept on `io` using Socket.IO's internal adapter which doesn't
    // expose a server-side on() for emitted events. Instead, wrap the emit.
    const origEmit = this.io.emit.bind(this.io);
    const self = this;
    (this.io as any).emit = function (event: string, ...args: any[]): boolean {
      if (event === 'build:completed' && args[0]) {
        try {
          self.onBuildCompleted(args[0]);
        } catch (err: any) {
          logger.error({ err: err.message }, 'CampaignManager: build:completed hook failed');
        }
      }
      return origEmit(event as any, ...args as any[]);
    };
  }

  private onBuildCompleted(job: BuildJob & { error?: string }): void {
    if (!job || !job.id) return;
    // Find the campaign + structure owning this build job
    for (const campaign of this.campaigns.values()) {
      const structure = campaign.structures.find((s) => s.buildJobId === job.id);
      if (!structure) continue;

      const success = job.status === 'completed';
      structure.status = success ? 'completed' : (job.status === 'cancelled' ? 'cancelled' : 'failed');
      structure.completedAt = Date.now();
      if (!success && job.error) structure.error = job.error;
      else if (!success) structure.error = `Build ended with status: ${job.status}`;

      campaign.updatedAt = Date.now();

      if (success) {
        this.io.emit(CAMPAIGN_EVENTS.STRUCTURE_COMPLETED, { campaignId: campaign.id, structure });
        this.eventLog.push({
          type: CAMPAIGN_EVENTS.STRUCTURE_COMPLETED,
          botName: 'campaign',
          description: `Campaign ${campaign.name}: structure ${structure.id} completed`,
          metadata: { campaignId: campaign.id, structureId: structure.id },
        });
      } else {
        this.io.emit(CAMPAIGN_EVENTS.STRUCTURE_FAILED, { campaignId: campaign.id, structure });
        this.eventLog.push({
          type: CAMPAIGN_EVENTS.STRUCTURE_FAILED,
          botName: 'campaign',
          description: `Campaign ${campaign.name}: structure ${structure.id} failed`,
          metadata: { campaignId: campaign.id, structureId: structure.id, error: structure.error },
        });
      }

      this.schedulePersist();
      // Re-run the dispatcher to pick up the next pending structure (or finalize).
      this.tryDispatch(campaign.id);
      return;
    }
  }

  // ── CRUD ────────────────────────────────────────────────

  createCampaign(input: CreateCampaignInput): Campaign {
    const id = crypto.randomUUID();
    const now = Date.now();
    const structures: CampaignStructure[] = input.structures.map((s) => ({
      id: crypto.randomUUID(),
      schematicFile: s.schematicFile,
      origin: s.origin,
      botCountHint: s.botCountHint,
      status: 'pending',
    }));

    const campaign: Campaign = {
      id,
      name: input.name,
      structures,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      maxParallel: input.maxParallel ?? DEFAULT_MAX_PARALLEL,
      autoSpawn: input.autoSpawn ?? false,
      spawnPersonality: input.spawnPersonality ?? DEFAULT_SPAWN_PERSONALITY,
      cleanupBots: input.cleanupBots ?? false,
      spawnedBotNames: [],
    };

    this.campaigns.set(id, campaign);
    this.schedulePersist();
    this.io.emit(CAMPAIGN_EVENTS.CREATED, campaign);
    this.eventLog.push({
      type: CAMPAIGN_EVENTS.CREATED,
      botName: 'campaign',
      description: `Campaign created: ${campaign.name} (${structures.length} structures)`,
      metadata: { campaignId: id },
    });
    logger.info({ campaignId: id, name: campaign.name, structures: structures.length }, 'Campaign created');
    return campaign;
  }

  getCampaign(id: string): Campaign | undefined {
    return this.campaigns.get(id);
  }

  listCampaigns(): Campaign[] {
    return [...this.campaigns.values()];
  }

  cancelCampaign(id: string): boolean {
    const campaign = this.campaigns.get(id);
    if (!campaign) return false;
    if (campaign.status === 'completed' || campaign.status === 'cancelled') return false;

    // Cancel any still-building sub-builds
    for (const structure of campaign.structures) {
      if (structure.status === 'building' && structure.buildJobId) {
        try {
          this.buildCoordinator.cancelBuild(structure.buildJobId);
        } catch (err: any) {
          logger.warn({ err: err.message, buildJobId: structure.buildJobId }, 'Failed to cancel child build');
        }
      }
      if (structure.status === 'pending' || structure.status === 'building') {
        structure.status = 'cancelled';
      }
    }

    campaign.status = 'cancelled';
    campaign.updatedAt = Date.now();

    const retry = this.retryTimers.get(id);
    if (retry) {
      clearTimeout(retry);
      this.retryTimers.delete(id);
    }

    this.io.emit(CAMPAIGN_EVENTS.CANCELLED, campaign);
    this.eventLog.push({
      type: CAMPAIGN_EVENTS.CANCELLED,
      botName: 'campaign',
      description: `Campaign cancelled: ${campaign.name}`,
      metadata: { campaignId: id },
    });
    this.schedulePersist();
    this.maybeCleanupBots(campaign);
    return true;
  }

  pauseCampaign(id: string): boolean {
    const campaign = this.campaigns.get(id);
    if (!campaign) return false;
    if (campaign.status !== 'running' && campaign.status !== 'pending') return false;
    campaign.status = 'paused';
    campaign.updatedAt = Date.now();

    const retry = this.retryTimers.get(id);
    if (retry) {
      clearTimeout(retry);
      this.retryTimers.delete(id);
    }

    this.io.emit(CAMPAIGN_EVENTS.PAUSED, campaign);
    this.eventLog.push({
      type: CAMPAIGN_EVENTS.PAUSED,
      botName: 'campaign',
      description: `Campaign paused: ${campaign.name}`,
      metadata: { campaignId: id },
    });
    this.schedulePersist();
    return true;
  }

  resumeCampaign(id: string): boolean {
    const campaign = this.campaigns.get(id);
    if (!campaign) return false;
    if (campaign.status !== 'paused') return false;
    campaign.status = 'running';
    campaign.updatedAt = Date.now();
    this.io.emit(CAMPAIGN_EVENTS.RESUMED, campaign);
    this.eventLog.push({
      type: CAMPAIGN_EVENTS.RESUMED,
      botName: 'campaign',
      description: `Campaign resumed: ${campaign.name}`,
      metadata: { campaignId: id },
    });
    this.schedulePersist();
    this.tryDispatch(id);
    return true;
  }

  deleteCampaign(id: string): boolean {
    const campaign = this.campaigns.get(id);
    if (!campaign) return false;
    // If the campaign is still active, first cancel it.
    if (campaign.status === 'running' || campaign.status === 'paused' || campaign.status === 'pending') {
      this.cancelCampaign(id);
    }
    this.campaigns.delete(id);
    const retry = this.retryTimers.get(id);
    if (retry) {
      clearTimeout(retry);
      this.retryTimers.delete(id);
    }
    this.io.emit(CAMPAIGN_EVENTS.DELETED, { id });
    this.eventLog.push({
      type: CAMPAIGN_EVENTS.DELETED,
      botName: 'campaign',
      description: `Campaign deleted: ${campaign.name}`,
      metadata: { campaignId: id },
    });
    this.schedulePersist();
    return true;
  }

  // ── Lifecycle ───────────────────────────────────────────

  async startCampaign(id: string): Promise<Campaign> {
    const campaign = this.campaigns.get(id);
    if (!campaign) throw new Error(`Campaign not found: ${id}`);
    if (campaign.status === 'running') return campaign;
    if (campaign.status === 'completed' || campaign.status === 'cancelled') {
      throw new Error(`Cannot start campaign in status: ${campaign.status}`);
    }

    campaign.status = 'running';
    campaign.updatedAt = Date.now();
    this.io.emit(CAMPAIGN_EVENTS.STARTED, campaign);
    this.eventLog.push({
      type: CAMPAIGN_EVENTS.STARTED,
      botName: 'campaign',
      description: `Campaign started: ${campaign.name}`,
      metadata: { campaignId: id },
    });
    this.schedulePersist();

    // Kick off dispatcher (runs async; returns immediately).
    this.tryDispatch(id);
    return campaign;
  }

  /**
   * Resume any campaigns that were running or paused when the process was
   * last killed. For structures with a buildJobId that is already known to
   * the BuildCoordinator, rewire listening (the build listener is global,
   * no per-structure rewire needed). For orphaned buildJobIds (coordinator
   * doesn't know about them), mark structure as failed.
   */
  async resumePendingCampaigns(): Promise<void> {
    const toResume = [...this.campaigns.values()].filter(
      (c) => c.status === 'running' || c.status === 'paused',
    );
    for (const campaign of toResume) {
      try {
        logger.info(
          { campaignId: campaign.id, name: campaign.name, status: campaign.status, structures: campaign.structures.length },
          'Resuming persisted campaign',
        );

        // Reconcile structures that were mid-build when the process died.
        for (const structure of campaign.structures) {
          if (structure.status === 'building' && structure.buildJobId) {
            const job = this.buildCoordinator.getBuildJob(structure.buildJobId);
            if (!job) {
              // Orphaned build — can't be resumed.
              structure.status = 'failed';
              structure.error = 'Build job missing after restart';
              structure.completedAt = Date.now();
              this.io.emit(CAMPAIGN_EVENTS.STRUCTURE_FAILED, { campaignId: campaign.id, structure });
            } else if (job.status === 'completed') {
              structure.status = 'completed';
              structure.completedAt = Date.now();
              this.io.emit(CAMPAIGN_EVENTS.STRUCTURE_COMPLETED, { campaignId: campaign.id, structure });
            } else if (job.status === 'failed' || job.status === 'cancelled') {
              structure.status = job.status === 'cancelled' ? 'cancelled' : 'failed';
              structure.completedAt = Date.now();
              this.io.emit(CAMPAIGN_EVENTS.STRUCTURE_FAILED, { campaignId: campaign.id, structure });
            }
            // If job is still running/paused, the build listener will catch its completion.
          }
        }

        this.schedulePersist();
        if (campaign.status === 'running') {
          this.tryDispatch(campaign.id);
        }
      } catch (err: any) {
        logger.error({ campaignId: campaign.id, err: err.message }, 'Failed to resume campaign');
        campaign.status = 'failed';
        campaign.updatedAt = Date.now();
        this.schedulePersist();
      }
    }
  }

  // ── Dispatch loop ───────────────────────────────────────

  /**
   * Core scheduler: picks up to maxParallel pending structures and starts
   * builds for them. Idempotent — safe to call multiple times. Will re-enter
   * itself via the onBuildCompleted hook.
   */
  private tryDispatch(campaignId: string): void {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) return;
    if (campaign.status !== 'running') return;
    if (this.dispatching.has(campaignId)) return;

    this.dispatching.add(campaignId);
    // Run async; swallow errors so dispatching flag is always cleared.
    this.dispatchOnce(campaign)
      .catch((err: any) => {
        logger.error({ campaignId, err: err.message }, 'Campaign dispatch failed');
      })
      .finally(() => {
        this.dispatching.delete(campaignId);
      });
  }

  private async dispatchOnce(campaign: Campaign): Promise<void> {
    const maxParallel = Math.max(1, campaign.maxParallel ?? DEFAULT_MAX_PARALLEL);

    // Check for terminal state first.
    const allDone = campaign.structures.every(
      (s) => s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled',
    );
    if (allDone) {
      this.finalizeCampaign(campaign);
      return;
    }

    // How many are currently in-flight?
    const inFlight = campaign.structures.filter((s) => s.status === 'building').length;
    let slotsAvailable = Math.max(0, maxParallel - inFlight);
    if (slotsAvailable === 0) return;

    // Bots already committed to an in-flight structure of this campaign.
    const busyBots = new Set<string>();
    for (const s of campaign.structures) {
      if (s.status === 'building' && s.buildJobId) {
        const job = this.buildCoordinator.getBuildJob(s.buildJobId);
        if (job) {
          for (const a of job.assignments) busyBots.add(a.botName);
        }
      }
    }

    // Also exclude bots busy on builds belonging to other campaigns.
    for (const otherCampaign of this.campaigns.values()) {
      if (otherCampaign.id === campaign.id) continue;
      for (const s of otherCampaign.structures) {
        if (s.status === 'building' && s.buildJobId) {
          const job = this.buildCoordinator.getBuildJob(s.buildJobId);
          if (job) {
            for (const a of job.assignments) busyBots.add(a.botName);
          }
        }
      }
    }

    let deferredDueToNoCrew = false;

    for (const structure of campaign.structures) {
      if (slotsAvailable <= 0) break;
      if (campaign.status !== 'running') return;
      if (structure.status !== 'pending') continue;

      const desiredCount = Math.max(1, structure.botCountHint ?? DEFAULT_BOT_COUNT_HINT);

      // First: try to select idle bots from the current pool.
      let crew = selectCrew(this.botManager, {
        count: desiredCount,
        exclude: busyBots,
        near: structure.origin,
      });

      if (crew.length === 0 && campaign.autoSpawn) {
        // Try spawning new bots.
        const spawnedNames = await this.spawnBotsForStructure(campaign, structure, desiredCount);
        if (spawnedNames.length > 0) {
          // Wait briefly for them to connect.
          await this.sleep(SPAWN_WAIT_MS);
          crew = selectCrew(this.botManager, {
            count: desiredCount,
            exclude: busyBots,
            near: structure.origin,
          });
          // If our spawned bots still aren't IDLE yet, just use them by name as best-effort.
          if (crew.length === 0) {
            crew = spawnedNames.slice(0, desiredCount);
          }
        }
      }

      if (crew.length === 0) {
        deferredDueToNoCrew = true;
        continue;
      }

      // Start the build.
      try {
        const job = await this.buildCoordinator.startBuild(
          structure.schematicFile,
          structure.origin,
          crew,
          {
            fillFoundation: true,
            snapToGround: true,
            clearSite: true,
            cleanupBotNames: undefined,
          },
        );
        structure.buildJobId = job.id;
        structure.status = 'building';
        structure.startedAt = Date.now();
        campaign.updatedAt = Date.now();
        for (const name of crew) busyBots.add(name);
        slotsAvailable--;

        this.io.emit(CAMPAIGN_EVENTS.STRUCTURE_STARTED, { campaignId: campaign.id, structure });
        this.eventLog.push({
          type: CAMPAIGN_EVENTS.STRUCTURE_STARTED,
          botName: crew.join(', '),
          description: `Campaign ${campaign.name}: structure ${structure.id} started`,
          metadata: { campaignId: campaign.id, structureId: structure.id, buildJobId: job.id },
        });
        this.schedulePersist();
      } catch (err: any) {
        structure.status = 'failed';
        structure.error = err.message;
        structure.completedAt = Date.now();
        campaign.updatedAt = Date.now();
        this.io.emit(CAMPAIGN_EVENTS.STRUCTURE_FAILED, { campaignId: campaign.id, structure });
        this.eventLog.push({
          type: CAMPAIGN_EVENTS.STRUCTURE_FAILED,
          botName: 'campaign',
          description: `Campaign ${campaign.name}: structure ${structure.id} failed to start: ${err.message}`,
          metadata: { campaignId: campaign.id, structureId: structure.id },
        });
        this.schedulePersist();
      }
    }

    // If a structure was deferred because no crew was available, schedule a retry.
    if (deferredDueToNoCrew) {
      this.scheduleRetry(campaign.id);
    } else {
      // Finalize check after dispatch loop (if everything finished synchronously).
      const afterDispatchAllDone = campaign.structures.every(
        (s) => s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled',
      );
      if (afterDispatchAllDone) {
        this.finalizeCampaign(campaign);
      }
    }
  }

  private scheduleRetry(campaignId: string): void {
    if (this.retryTimers.has(campaignId)) return;
    const timer = setTimeout(() => {
      this.retryTimers.delete(campaignId);
      this.tryDispatch(campaignId);
    }, NO_CREW_RETRY_MS);
    this.retryTimers.set(campaignId, timer);
  }

  private async spawnBotsForStructure(
    campaign: Campaign,
    structure: CampaignStructure,
    count: number,
  ): Promise<string[]> {
    const personality = campaign.spawnPersonality ?? DEFAULT_SPAWN_PERSONALITY;
    const spawned: string[] = [];
    const prefixCampaign = campaign.id.slice(0, 6);
    const prefixStructure = structure.id.slice(0, 4);
    for (let i = 0; i < count; i++) {
      const name = `${prefixCampaign}-${prefixStructure}-${i}`;
      try {
        const handle = await this.botManager.spawnBot(name, personality, undefined, 'codegen');
        if (handle) {
          spawned.push(name);
          if (!campaign.spawnedBotNames) campaign.spawnedBotNames = [];
          campaign.spawnedBotNames.push(name);
        }
      } catch (err: any) {
        logger.warn({ err: err.message, name }, 'Failed to spawn campaign bot');
      }
    }
    if (spawned.length > 0) {
      campaign.updatedAt = Date.now();
      this.schedulePersist();
      logger.info({ campaignId: campaign.id, structureId: structure.id, count: spawned.length }, 'Campaign spawned bots for structure');
    }
    return spawned;
  }

  private finalizeCampaign(campaign: Campaign): void {
    const anyFailed = campaign.structures.some((s) => s.status === 'failed');
    const anyCancelled = campaign.structures.some((s) => s.status === 'cancelled');
    const anyCompleted = campaign.structures.some((s) => s.status === 'completed');

    if (campaign.status === 'cancelled') {
      // Already finalized as cancelled earlier.
      this.maybeCleanupBots(campaign);
      return;
    }

    let newStatus: CampaignStatus;
    if (anyCompleted && !anyFailed && !anyCancelled) {
      newStatus = 'completed';
    } else if (!anyCompleted && (anyFailed || anyCancelled)) {
      newStatus = 'failed';
    } else if (anyCompleted && (anyFailed || anyCancelled)) {
      // Partial success — treat as completed but note that some failed.
      newStatus = 'completed';
    } else {
      newStatus = 'completed';
    }

    campaign.status = newStatus;
    campaign.updatedAt = Date.now();

    if (newStatus === 'completed') {
      this.io.emit(CAMPAIGN_EVENTS.COMPLETED, campaign);
      this.eventLog.push({
        type: CAMPAIGN_EVENTS.COMPLETED,
        botName: 'campaign',
        description: `Campaign completed: ${campaign.name}`,
        metadata: { campaignId: campaign.id },
      });
    } else {
      this.io.emit(CAMPAIGN_EVENTS.FAILED, campaign);
      this.eventLog.push({
        type: CAMPAIGN_EVENTS.FAILED,
        botName: 'campaign',
        description: `Campaign failed: ${campaign.name}`,
        metadata: { campaignId: campaign.id },
      });
    }

    this.schedulePersist();
    this.maybeCleanupBots(campaign);
  }

  private maybeCleanupBots(campaign: Campaign): void {
    if (!campaign.cleanupBots) return;
    const names = campaign.spawnedBotNames ?? [];
    if (names.length === 0) return;

    // Fire and forget — we don't want to block the dispatch loop on removals.
    (async () => {
      for (const name of names) {
        try {
          await this.botManager.removeBot(name);
          logger.info({ campaignId: campaign.id, bot: name }, 'Campaign cleaned up spawned bot');
        } catch (err: any) {
          logger.warn({ campaignId: campaign.id, bot: name, err: err.message }, 'Campaign cleanup failed for bot');
        }
      }
    })();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
