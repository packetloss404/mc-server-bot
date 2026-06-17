import { BotManager } from '../bot/BotManager';
import { Server as SocketIOServer } from 'socket.io';
import { EventLog } from '../server/EventLog';
import { logger } from '../util/logger';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// ── Interfaces ──────────────────────────────────────────────

export interface ChestLocation {
  x: number;
  y: number;
  z: number;
  label: string;
}

export type StageStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed';
export type ChainStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed';

export interface ChainStage {
  id: string;
  botName: string;
  task: string;
  inputChest?: ChestLocation;
  outputChest?: ChestLocation;
  inputItems?: { item: string; count: number }[];
  outputItems?: { item: string; count: number }[];
  status: StageStatus;
  startedAt?: number;
  completedAt?: number;
  retries: number;
  error?: string;
}

export interface SupplyChain {
  id: string;
  name: string;
  description?: string;
  stages: ChainStage[];
  status: ChainStatus;
  currentStageIndex: number;
  loop: boolean;
  /**
   * Upper bound on full passes through `stages` when `loop===true`. Without
   * this, a loop chain runs forever even when no one is watching, eating
   * resources and skill-cache slots. Defaults to DEFAULT_MAX_ITERATIONS
   * (1000) at create time. Ignored when `loop===false`.
   */
  maxIterations?: number;
  /** Completed full passes through the stages list. Bumped on each loop. */
  iterations?: number;
  createdAt: number;
  updatedAt: number;
}

export interface ChainTemplate {
  id: string;
  name: string;
  description: string;
  stages: {
    task: string;
    inputItems?: { item: string; count: number }[];
    outputItems?: { item: string; count: number }[];
  }[];
}

/**
 * Default cap on full passes through a loop chain. At ~10s/stage and 2-3
 * stages this is roughly 5-8 hours of work — far past anything a human will
 * actually wait for, but high enough that legitimate long-running loops
 * (overnight resource farms, etc.) don't choke on the default.
 */
const DEFAULT_MAX_ITERATIONS = 1000;

// ── Built-in templates ──────────────────────────────────────

const TEMPLATES: ChainTemplate[] = [
  {
    id: 'iron-ingots',
    name: 'Iron Ingot Production',
    description: 'Mine iron ore, smelt into ingots',
    stages: [
      { task: 'Mine {count} iron_ore', outputItems: [{ item: 'raw_iron', count: 8 }] },
      {
        task: 'Smelt {count} raw_iron using coal as fuel',
        inputItems: [{ item: 'raw_iron', count: 8 }],
        outputItems: [{ item: 'iron_ingot', count: 8 }],
      },
    ],
  },
  {
    id: 'stone-tools',
    name: 'Stone Tool Crafting',
    description: 'Mine cobblestone and craft stone tools',
    stages: [
      { task: 'Mine 12 cobblestone and 4 oak_log', outputItems: [{ item: 'cobblestone', count: 12 }] },
      {
        task: 'Craft 2 stone_pickaxe and 1 stone_axe',
        inputItems: [{ item: 'cobblestone', count: 12 }],
        outputItems: [{ item: 'stone_pickaxe', count: 2 }],
      },
    ],
  },
  {
    id: 'bread-production',
    name: 'Bread Production',
    description: 'Harvest wheat, craft into bread',
    stages: [
      { task: 'Harvest 9 wheat', outputItems: [{ item: 'wheat', count: 9 }] },
      {
        task: 'Craft 3 bread from 9 wheat',
        inputItems: [{ item: 'wheat', count: 9 }],
        outputItems: [{ item: 'bread', count: 3 }],
      },
    ],
  },
];

// ── Chain Coordinator ───────────────────────────────────────

export class ChainCoordinator {
  private botManager: BotManager;
  private io: SocketIOServer;
  private eventLog: EventLog;
  private chains: Map<string, SupplyChain> = new Map();
  private dataPath: string;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private taskDescriptionMap: Map<string, string> = new Map(); // stageId -> task description sent to bot
  /** stageId -> {completedCount, failedCount} last seen on the bot. Lets us skip
   *  the substring scan entirely when no new tasks have completed/failed. */
  private lastObservedCounts: Map<string, { completed: number; failed: number }> = new Map();

  constructor(botManager: BotManager, io: SocketIOServer, eventLog: EventLog) {
    this.botManager = botManager;
    this.io = io;
    this.eventLog = eventLog;
    this.dataPath = path.join(process.cwd(), 'data', 'supply_chains.json');
    this.load();
    this.startPolling();
  }

  // ── Persistence ─────────────────────────────────────────

  private load(): void {
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = fs.readFileSync(this.dataPath, 'utf-8');
        const arr: SupplyChain[] = JSON.parse(raw);
        for (const chain of arr) {
          this.chains.set(chain.id, chain);
        }
        logger.info({ count: arr.length }, 'Loaded supply chains from disk');
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to load supply chains, starting fresh');
    }
  }

  private save(): void {
    try {
      const arr = [...this.chains.values()];
      // Use atomicWriteJsonSync (write-to-tmp + rename) so a crash mid-save
      // can't leave a half-written supply_chains.json behind. The helper
      // also handles mkdir-if-missing internally.
      atomicWriteJsonSync(this.dataPath, arr);
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to save supply chains');
    }
  }

  // ── Templates ───────────────────────────────────────────

  getTemplates(): ChainTemplate[] {
    return TEMPLATES;
  }

  // ── CRUD ────────────────────────────────────────────────

  getAllChains(): SupplyChain[] {
    return [...this.chains.values()];
  }

  getChain(id: string): SupplyChain | undefined {
    return this.chains.get(id);
  }

  createChain(opts: {
    name: string;
    description?: string;
    templateId?: string;
    stages?: ChainStage[];
    loop?: boolean;
    /**
     * Per-stage maximum iterations when `loop===true`. Defaults to
     * DEFAULT_MAX_ITERATIONS (1000). Must be a positive integer. Ignored
     * when `loop===false`.
     */
    maxIterations?: number;
    botAssignments?: Record<number, string>;
    chestLocations?: Record<number, { input?: ChestLocation; output?: ChestLocation }>;
  }): SupplyChain {
    const chainId = crypto.randomUUID();
    let stages: ChainStage[];

    if (opts.templateId) {
      const template = TEMPLATES.find((t) => t.id === opts.templateId);
      if (!template) {
        throw new Error(`Template not found: ${opts.templateId}`);
      }

      stages = template.stages.map((tmplStage, idx) => {
        const botName = opts.botAssignments?.[idx] ?? '';
        const chests = opts.chestLocations?.[idx];

        return {
          id: crypto.randomUUID(),
          botName,
          task: tmplStage.task,
          inputChest: chests?.input,
          outputChest: chests?.output,
          inputItems: tmplStage.inputItems,
          outputItems: tmplStage.outputItems,
          status: 'pending' as StageStatus,
          retries: 0,
        };
      });
    } else if (opts.stages) {
      stages = opts.stages.map((s) => ({
        ...s,
        id: s.id || crypto.randomUUID(),
        status: 'pending' as StageStatus,
        retries: s.retries ?? 0,
      }));
    } else {
      throw new Error('Either templateId or stages must be provided');
    }

    // Validate bot assignments at create time. Previously a stage could be
    // created with an empty botName="" (e.g. when the caller forgot to set
    // botAssignments[idx]) and the chain would only blow up at first
    // execution. Now we reject up-front with the bad stage index so the API
    // caller can fix it immediately.
    for (let idx = 0; idx < stages.length; idx++) {
      const stage = stages[idx];
      if (!stage.botName || stage.botName.trim() === '') {
        throw new Error(`Stage ${idx} has no bot assigned (botAssignments[${idx}] is missing or empty)`);
      }
      const bot = this.botManager.getWorker(stage.botName);
      if (!bot) {
        throw new Error(`Stage ${idx} references unknown bot: "${stage.botName}"`);
      }
    }

    // Validate maxIterations if loop mode is on. A negative or zero value is
    // a caller bug — silently coercing it would hide the mistake.
    let maxIterations: number | undefined;
    if (opts.loop) {
      if (opts.maxIterations !== undefined) {
        if (!Number.isFinite(opts.maxIterations) || !Number.isInteger(opts.maxIterations) || opts.maxIterations <= 0) {
          throw new Error(`maxIterations must be a positive integer, got: ${opts.maxIterations}`);
        }
        maxIterations = opts.maxIterations;
      } else {
        maxIterations = DEFAULT_MAX_ITERATIONS;
      }
    }

    const chain: SupplyChain = {
      id: chainId,
      name: opts.name,
      description: opts.description,
      stages,
      status: 'idle',
      currentStageIndex: 0,
      loop: opts.loop ?? false,
      maxIterations,
      iterations: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.chains.set(chainId, chain);
    this.save();

    logger.info({ chainId, name: chain.name, stageCount: stages.length }, 'Supply chain created');
    return chain;
  }

  deleteChain(id: string): boolean {
    const chain = this.chains.get(id);
    if (!chain) return false;

    this.chains.delete(id);
    this.save();

    logger.info({ chainId: id, name: chain.name }, 'Supply chain deleted');
    return true;
  }

  // ── Execution control ─────────────────────────────────

  startChain(id: string): boolean {
    const chain = this.chains.get(id);
    if (!chain || chain.status === 'running') return false;

    // Reset all stages
    for (const stage of chain.stages) {
      stage.status = 'pending';
      stage.startedAt = undefined;
      stage.completedAt = undefined;
      stage.error = undefined;
      stage.retries = 0;
    }

    chain.status = 'running';
    chain.currentStageIndex = 0;
    chain.iterations = 0;
    chain.updatedAt = Date.now();
    this.save();

    this.io.emit('chain:started', { id: chain.id, name: chain.name });
    this.eventLog.push({
      type: 'chain:started',
      botName: chain.stages.map((s) => s.botName).filter(Boolean).join(', '),
      description: `Supply chain started: ${chain.name}`,
      metadata: { id: chain.id },
    });

    logger.info({ id: chain.id, name: chain.name }, 'Supply chain started');

    this.advanceStage(chain);
    return true;
  }

  pauseChain(id: string): boolean {
    const chain = this.chains.get(id);
    if (!chain || chain.status !== 'running') return false;

    chain.status = 'paused';
    chain.updatedAt = Date.now();
    this.save();

    this.io.emit('chain:paused', { id: chain.id });
    this.eventLog.push({
      type: 'chain:paused',
      botName: chain.stages[chain.currentStageIndex]?.botName ?? '',
      description: `Supply chain paused: ${chain.name}`,
      metadata: { id: chain.id },
    });

    logger.info({ id: chain.id, name: chain.name }, 'Supply chain paused');
    return true;
  }

  cancelChain(id: string): boolean {
    const chain = this.chains.get(id);
    if (!chain) return false;

    // Reset all stages to pending
    for (const stage of chain.stages) {
      stage.status = 'pending';
      stage.startedAt = undefined;
      stage.completedAt = undefined;
      stage.error = undefined;
    }

    chain.status = 'idle';
    chain.currentStageIndex = 0;
    chain.updatedAt = Date.now();
    this.save();

    this.io.emit('chain:cancelled', { id: chain.id });
    this.eventLog.push({
      type: 'chain:cancelled',
      botName: chain.stages.map((s) => s.botName).filter(Boolean).join(', '),
      description: `Supply chain cancelled: ${chain.name}`,
      metadata: { id: chain.id },
    });

    logger.info({ id: chain.id, name: chain.name }, 'Supply chain cancelled');
    return true;
  }

  // ── Stage advancement ─────────────────────────────────

  private advanceStage(chain: SupplyChain): void {
    if (chain.status !== 'running') return;

    const stageIndex = chain.currentStageIndex;
    if (stageIndex >= chain.stages.length) {
      // All stages complete
      chain.status = 'completed';
      chain.updatedAt = Date.now();
      this.save();

      this.io.emit('chain:completed', { id: chain.id, name: chain.name });
      this.eventLog.push({
        type: 'chain:completed',
        botName: chain.stages.map((s) => s.botName).filter(Boolean).join(', '),
        description: `Supply chain completed: ${chain.name}`,
        metadata: { id: chain.id },
      });

      logger.info({ id: chain.id, name: chain.name }, 'Supply chain completed');
      return;
    }

    const stage = chain.stages[stageIndex];
    if (!stage.botName) {
      stage.status = 'failed';
      stage.error = 'No bot assigned to stage';
      chain.status = 'failed';
      chain.updatedAt = Date.now();
      this.save();

      this.io.emit('chain:stage-update', { id: chain.id, stageIndex, stage });
      this.io.emit('chain:failed', { id: chain.id, name: chain.name, error: stage.error });
      return;
    }

    const botWorker = this.botManager.getWorker(stage.botName) as any;
    if (!botWorker) {
      stage.status = 'failed';
      stage.error = `Bot not found: ${stage.botName}`;
      chain.status = 'failed';
      chain.updatedAt = Date.now();
      this.save();

      this.io.emit('chain:stage-update', { id: chain.id, stageIndex, stage });
      this.io.emit('chain:failed', { id: chain.id, name: chain.name, error: stage.error });
      return;
    }

    // Bots run in worker threads, so the in-thread VoyagerLoop is unreachable
    // from here. Detect codegen mode via the worker's cached status (voyager is
    // null for primitive-mode bots) and queue the task via a worker command.
    const cached = botWorker.getCachedDetailedStatus?.();
    if (cached && cached.voyager === null) {
      stage.status = 'failed';
      stage.error = `Bot ${stage.botName} is not in codegen mode`;
      chain.status = 'failed';
      chain.updatedAt = Date.now();
      this.save();

      this.io.emit('chain:stage-update', { id: chain.id, stageIndex, stage });
      this.io.emit('chain:failed', { id: chain.id, name: chain.name, error: stage.error });
      return;
    }

    const taskDescription = this.buildTaskDescription(stage);
    this.taskDescriptionMap.set(stage.id, taskDescription);

    botWorker.queueTask(taskDescription, 'supply-chain');

    stage.status = 'running';
    stage.startedAt = Date.now();
    chain.updatedAt = Date.now();
    this.save();

    this.io.emit('chain:stage-update', { id: chain.id, stageIndex, stage });

    logger.info(
      { chainId: chain.id, stageIndex, botName: stage.botName, task: taskDescription },
      'Supply chain stage queued',
    );
  }

  private buildTaskDescription(stage: ChainStage): string {
    let description = stage.task;

    if (stage.inputChest) {
      const c = stage.inputChest;
      description += `. First go to coordinates (${c.x}, ${c.y}, ${c.z}) and collect items from the chest`;
      if (stage.inputItems && stage.inputItems.length > 0) {
        const itemList = stage.inputItems.map((i) => `${i.count} ${i.item}`).join(', ');
        description += ` (need: ${itemList})`;
      }
      description += '.';
    }

    if (stage.outputChest) {
      const c = stage.outputChest;
      description += ` Then go to coordinates (${c.x}, ${c.y}, ${c.z}) and deposit`;
      if (stage.outputItems && stage.outputItems.length > 0) {
        const itemList = stage.outputItems.map((i) => `${i.count} ${i.item}`).join(', ');
        description += ` ${itemList}`;
      } else {
        description += ' the results';
      }
      description += ' into the chest.';
    }

    return description;
  }

  // ── Polling ───────────────────────────────────────────

  private startPolling(): void {
    if (this.pollingInterval) return;
    this.pollingInterval = setInterval(() => {
      // checkChainProgress is async (it reads worker task state over IPC) and
      // must never reject into the timer — an unhandled throw here would crash
      // the process. Swallow-and-log so a wedged tick can't take down the bot.
      this.checkChainProgress().catch((err: any) => {
        logger.warn({ err: err?.message }, 'ChainCoordinator poll tick failed; continuing');
      });
    }, 5000);
  }

  /** True if there's at least one chain in 'running' status. */
  private hasActiveChains(): boolean {
    for (const chain of this.chains.values()) {
      if (chain.status === 'running') return true;
    }
    return false;
  }

  private async checkChainProgress(): Promise<void> {
    // Skip the per-chain scan entirely if no chain is active.
    if (!this.hasActiveChains()) return;
    // Snapshot the chains: we await IPC reads below and a chain could be
    // cancelled/deleted mid-loop.
    for (const chain of [...this.chains.values()]) {
      if (chain.status !== 'running') continue;

      const stageIndex = chain.currentStageIndex;
      if (stageIndex >= chain.stages.length) continue;

      const stage = chain.stages[stageIndex];
      if (stage.status !== 'running') continue;

      const stageBot = this.botManager.getWorker(stage.botName) as any;
      if (!stageBot) continue;

      // Bots run in worker threads — read the VoyagerLoop task state over IPC
      // (we can't touch the in-thread loop directly). null means the worker
      // isn't running or the bot isn't in codegen mode; skip and retry next tick.
      const state = await stageBot.getVoyagerTaskState();
      if (!state) continue;

      const taskDesc = this.taskDescriptionMap.get(stage.id) ?? stage.task;
      const currentTask: string | null = state.currentTask;
      const completedTasks: string[] = state.completedTasks ?? [];
      const failedTasks: string[] = state.failedTasks ?? [];
      const queuedTasks: string[] = state.queuedTasks ?? [];

      // Skip the substring scan entirely when neither list has grown since
      // the previous tick — no new task can have matched.
      const last = this.lastObservedCounts.get(stage.id);
      const newCompleted = last ? completedTasks.length > last.completed : completedTasks.length > 0;
      const newFailed = last ? failedTasks.length > last.failed : failedTasks.length > 0;
      this.lastObservedCounts.set(stage.id, { completed: completedTasks.length, failed: failedTasks.length });

      // Exact-equality match on the canonical task description stored at
      // queue time. The old bidirectional includes() let "Mine 12 cobblestone"
      // collide with "Mine 12 cobblestone and 4 oak_log" (both pass the
      // substring check), so a stage could spuriously advance on the wrong
      // bot's completion event. taskDescriptionMap is already keyed by
      // stageId, so we have the exact string we sent — use it verbatim.
      const isCompleted = newCompleted && completedTasks.some((t: string) => t === taskDesc);
      const isFailed = newFailed && failedTasks.some((t: string) => t === taskDesc);
      // #20 fix: a task that is still the bot's current task OR still sitting in
      // its queue is NOT lost — it's just waiting or temporarily preempted (e.g.
      // a survival interrupt). The old `taskFinished` heuristic re-queued it
      // anyway, creating a SECOND live copy and double-executing the stage. Only
      // treat it as abandoned when it's neither current nor queued.
      const stillPending = currentTask === taskDesc || queuedTasks.includes(taskDesc);

      if (isCompleted) {
        stage.status = 'completed';
        stage.completedAt = Date.now();
        chain.currentStageIndex++;
        chain.updatedAt = Date.now();
        this.save();

        this.io.emit('chain:stage-update', { id: chain.id, stageIndex, stage });

        logger.info(
          { chainId: chain.id, stageIndex, botName: stage.botName },
          'Supply chain stage completed',
        );

        // Check if chain should loop. Bound by maxIterations so a chain with
        // loop:true eventually self-terminates instead of polling forever.
        // Without this cap an idle cluster could be running a "make 8 ingots
        // forever" chain weeks after the operator forgot about it.
        if (chain.currentStageIndex >= chain.stages.length && chain.loop) {
          const iterations = (chain.iterations ?? 0) + 1;
          chain.iterations = iterations;
          const cap = chain.maxIterations ?? DEFAULT_MAX_ITERATIONS;
          if (iterations >= cap) {
            chain.status = 'completed';
            chain.updatedAt = Date.now();
            this.save();
            this.io.emit('chain:completed', { id: chain.id, name: chain.name, reason: 'max-iterations', iterations });
            this.eventLog.push({
              type: 'chain:completed',
              botName: chain.stages.map((s) => s.botName).filter(Boolean).join(', '),
              description: `Supply chain finished: ${chain.name} reached max iterations (${iterations}/${cap})`,
              metadata: { id: chain.id, iterations, maxIterations: cap, reason: 'max-iterations' },
            });
            logger.info(
              { id: chain.id, name: chain.name, iterations, maxIterations: cap },
              'Supply chain hit max iterations — terminating loop',
            );
            return;
          }
          logger.info({ id: chain.id, name: chain.name, iterations, maxIterations: cap }, 'Supply chain looping');
          for (const s of chain.stages) {
            s.status = 'pending';
            s.startedAt = undefined;
            s.completedAt = undefined;
            s.error = undefined;
            s.retries = 0;
          }
          chain.currentStageIndex = 0;
          chain.updatedAt = Date.now();
          this.save();
        }

        this.advanceStage(chain);
      } else if (isFailed || (!stillPending && stage.startedAt && Date.now() - stage.startedAt > 10000)) {
        // Task explicitly failed, OR it's been abandoned (not running, not
        // queued, not completed) for >10s. The !stillPending guard is the #20
        // fix: we never re-queue a task the bot is still working or has queued.
        stage.retries++;

        if (stage.retries < 3) {
          logger.warn(
            { chainId: chain.id, stageIndex, botName: stage.botName, retries: stage.retries },
            'Supply chain stage failed, retrying',
          );

          stage.status = 'queued';
          stage.error = undefined;
          chain.updatedAt = Date.now();
          this.save();

          this.io.emit('chain:stage-update', { id: chain.id, stageIndex, stage });

          // Re-queue the task via the worker command (in-thread loop is not
          // reachable from here). Reset the observed-count baseline so the
          // retry's completion isn't masked by the prior attempt's counts.
          const retryDesc = this.taskDescriptionMap.get(stage.id) ?? this.buildTaskDescription(stage);
          this.taskDescriptionMap.set(stage.id, retryDesc);
          this.lastObservedCounts.delete(stage.id);
          stageBot.queueTask(retryDesc, 'supply-chain');

          stage.status = 'running';
          stage.startedAt = Date.now();
          this.save();
        } else {
          stage.status = 'failed';
          stage.error = 'Max retries exceeded';
          chain.status = 'failed';
          chain.updatedAt = Date.now();
          this.save();

          this.io.emit('chain:stage-update', { id: chain.id, stageIndex, stage });
          this.io.emit('chain:failed', {
            id: chain.id,
            name: chain.name,
            error: `Stage ${stageIndex} failed after 3 retries`,
          });
          this.eventLog.push({
            type: 'chain:failed',
            botName: stage.botName,
            description: `Supply chain failed: ${chain.name} (stage ${stageIndex} exceeded retries)`,
            metadata: { chainId: chain.id, stageIndex },
          });

          logger.error(
            { chainId: chain.id, stageIndex, botName: stage.botName },
            'Supply chain stage failed permanently',
          );
        }
      }
    }
  }

  /** Stop polling and flush chain state to disk (call on process exit). */
  shutdown(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.save();
    logger.info('Chain coordinator shut down, state flushed to disk');
  }
}
