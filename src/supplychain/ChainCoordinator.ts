import { BotManager } from '../bot/BotManager';
import { Server as SocketIOServer } from 'socket.io';
import { EventLog } from '../server/EventLog';
import { logger } from '../util/logger';
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
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dataPath, JSON.stringify(arr, null, 2), 'utf-8');
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

    // Validate bot names
    for (const stage of stages) {
      if (stage.botName) {
        const bot = this.botManager.getWorker(stage.botName);
        if (!bot) {
          throw new Error(`Bot not found: ${stage.botName}`);
        }
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

    const voyager = botWorker.getVoyagerLoop();
    if (!voyager) {
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

    voyager.queuePlayerTask(taskDescription, 'supply-chain');

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
      this.checkChainProgress();
    }, 5000);
  }

  /** True if there's at least one chain in 'running' status. */
  private hasActiveChains(): boolean {
    for (const chain of this.chains.values()) {
      if (chain.status === 'running') return true;
    }
    return false;
  }

  private checkChainProgress(): void {
    // Skip the per-chain scan entirely if no chain is active.
    if (!this.hasActiveChains()) return;
    for (const chain of this.chains.values()) {
      if (chain.status !== 'running') continue;

      const stageIndex = chain.currentStageIndex;
      if (stageIndex >= chain.stages.length) continue;

      const stage = chain.stages[stageIndex];
      if (stage.status !== 'running') continue;

      const stageBot = this.botManager.getWorker(stage.botName) as any;
      if (!stageBot) continue;

      const voyager = stageBot.getVoyagerLoop();
      if (!voyager) continue;

      const taskDesc = this.taskDescriptionMap.get(stage.id) ?? stage.task;
      const currentTask = voyager.getCurrentTask();
      const completedTasks: string[] = voyager.getCompletedTasks();
      const failedTasks: string[] = voyager.getFailedTasks();

      // Skip the substring scan entirely when neither list has grown since
      // the previous tick — no new task can have matched.
      const last = this.lastObservedCounts.get(stage.id);
      const newCompleted = last ? completedTasks.length > last.completed : completedTasks.length > 0;
      const newFailed = last ? failedTasks.length > last.failed : failedTasks.length > 0;
      this.lastObservedCounts.set(stage.id, { completed: completedTasks.length, failed: failedTasks.length });

      const isCompleted = newCompleted && completedTasks.some((t: string) => t.includes(taskDesc) || taskDesc.includes(t));
      const isFailed = newFailed && failedTasks.some((t: string) => t.includes(taskDesc) || taskDesc.includes(t));
      const taskFinished = currentTask === null || (!currentTask.includes(taskDesc) && !taskDesc.includes(currentTask ?? ''));

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

        // Check if chain should loop
        if (chain.currentStageIndex >= chain.stages.length && chain.loop) {
          logger.info({ id: chain.id, name: chain.name }, 'Supply chain looping');
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
      } else if (isFailed || (taskFinished && stage.startedAt && Date.now() - stage.startedAt > 10000)) {
        // Task failed or bot moved on without completing — retry or fail
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

          // Re-queue the task
          const retryDesc = this.taskDescriptionMap.get(stage.id) ?? this.buildTaskDescription(stage);
          this.taskDescriptionMap.set(stage.id, retryDesc);
          voyager.queuePlayerTask(retryDesc, 'supply-chain');

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
