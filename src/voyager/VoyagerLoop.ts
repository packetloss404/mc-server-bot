import { Bot } from 'mineflayer';
import { LLMClient } from '../ai/LLMClient';
import { Config } from '../config';
import { SkillLibrary, SkillMatch } from './SkillLibrary';
import { CodeExecutor } from './CodeExecutor';
import { CurriculumAgent, Task } from './CurriculumAgent';
import { ActionAgent, GeneratedCode } from './ActionAgent';
import { CriticAgent, takeBotSnapshot } from './CriticAgent';
import { logger } from '../util/logger';
import { getProgressionState } from './Progression';
import { buildTaskPlan, PlannedStep, replanTaskStep } from './TaskPlanner';
import { StatsTracker } from './StatsTracker';
import { completeLongTermSubtask, goalSummary, LongTermGoal, longTermGoalToTask, makeLongTermGoal, popLongTermSubtask } from './LongTermGoal';
import { countBlueprintMaterials, generateSimpleHouseBlueprint, getMissingBlueprintPlacements, validateBlueprint } from './Blueprint';
import { placeBlock } from '../actions/placeBlock';
import { Vec3 } from 'vec3';
import { BlackboardManager, BlackboardTask } from './BlackboardManager';

export class VoyagerLoop {
  private static MAX_RETRY_EVENT_LOG_CHARS = 1200;
  private static MAX_FAILURE_OUTPUT_CHARS = 1200;
  private bot: Bot;
  private personality: string;
  private botName: string;
  private config: Config;
  private skillLibrary: SkillLibrary;
  private codeExecutor: CodeExecutor;
  private curriculumAgent: CurriculumAgent;
  private actionAgent: ActionAgent | null;
  private criticAgent: CriticAgent;
  private statsTracker: StatsTracker;
  private running = false;
  private paused = false;
  private loopTimeout: NodeJS.Timeout | null = null;
  private lastExecutionMetrics: {
    attempt: number;
    task: string;
    success: boolean;
    outputLength: number;
    eventCount: number;
    eventLogLength: number;
    codeLength: number;
    timestamp: number;
  } | null = null;
  private playerTaskQueue: Task[] = [];
  private activeLongTermGoal: LongTermGoal | null = null;
  private blackboardManager: BlackboardManager | null = null;
  private activeBlackboardTask: BlackboardTask | null = null;

  // Exposed state for chat context
  private currentTask: string | null = null;
  private lastCompletedTask: string | null = null;
  private lastFailedTask: string | null = null;

  constructor(
    bot: Bot,
    botName: string,
    personality: string,
    config: Config,
    llmClient: LLMClient | null
  ) {
    this.bot = bot;
    this.botName = botName;
    this.personality = personality;
    this.config = config;

    this.skillLibrary = new SkillLibrary(config.skills.directory, config.skills.maxSkills, llmClient);
    this.codeExecutor = new CodeExecutor(config.voyager.codeExecutionTimeoutMs);

    this.curriculumAgent = new CurriculumAgent(
      llmClient,
      config.voyager.curriculumLLMCalls,
      './data'
    );

    this.actionAgent = llmClient
      ? new ActionAgent(llmClient, config.llm.codeGenMaxTokens)
      : null;

    this.criticAgent = new CriticAgent(
      llmClient,
      config.voyager.criticLLMCalls
    );
    this.statsTracker = new StatsTracker('./data');
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info({ bot: this.botName }, 'Voyager loop started');
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.paused = false;
    if (this.loopTimeout) {
      clearTimeout(this.loopTimeout);
      this.loopTimeout = null;
    }
    logger.info({ bot: this.botName }, 'Voyager loop stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  pause(reason = 'paused'): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    if (this.loopTimeout) {
      clearTimeout(this.loopTimeout);
      this.loopTimeout = null;
    }
    this.codeExecutor.requestInterrupt(reason);
    logger.warn({ bot: this.botName, reason, task: this.currentTask }, 'Voyager loop paused');
  }

  resume(reason = 'resumed'): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    logger.info({ bot: this.botName, reason }, 'Voyager loop resumed');
    this.scheduleNext();
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Get the current task description, or null if idle */
  getCurrentTask(): string | null {
    return this.currentTask;
  }

  /** Get list of completed task descriptions (proxied from CurriculumAgent) */
  getCompletedTasks(): string[] {
    return this.curriculumAgent.getCompletedTasks();
  }

  /** Get list of failed task descriptions (proxied from CurriculumAgent) */
  getFailedTasks(): string[] {
    return this.curriculumAgent.getFailedTasks();
  }

  getQueuedTasks(): string[] {
    return this.playerTaskQueue.map((task) => task.description);
  }

  /** Reorder the player task queue to match the given order of descriptions */
  reorderQueue(orderedDescriptions: string[]): void {
    const byDesc = new Map<string, Task>();
    for (const task of this.playerTaskQueue) {
      byDesc.set(task.description, task);
    }
    const reordered: Task[] = [];
    for (const desc of orderedDescriptions) {
      const task = byDesc.get(desc);
      if (task) {
        reordered.push(task);
        byDesc.delete(desc);
      }
    }
    // Append any tasks not mentioned in the new order
    for (const task of byDesc.values()) {
      reordered.push(task);
    }
    this.playerTaskQueue = reordered;
    logger.info({ bot: this.botName, newOrder: reordered.map(t => t.description) }, 'Task queue reordered');
  }

  /** Clear the entire player task queue */
  clearQueue(): void {
    const count = this.playerTaskQueue.length;
    this.playerTaskQueue = [];
    logger.info({ bot: this.botName, cleared: count }, 'Task queue cleared');
  }

  /** Queue a player task at the front of the queue (prepend) */
  queuePlayerTaskFront(description: string, requestedBy: string): void {
    this.decomposeAndQueueFront(description, requestedBy).catch((err) => {
      logger.warn({ err: err.message, task: description }, 'Decompose failed, prepending raw task');
      const keywords = description
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2);
      this.playerTaskQueue.unshift({ description, keywords });
    });
  }

  private async decomposeAndQueueFront(description: string, requestedBy: string): Promise<void> {
    const subtasks = await this.curriculumAgent.decomposeTask(this.bot, description);
    // Insert at front in order (first subtask at index 0)
    for (let i = subtasks.length - 1; i >= 0; i--) {
      this.playerTaskQueue.unshift(subtasks[i]);
    }
    logger.info({
      bot: this.botName,
      goal: description,
      requestedBy,
      subtasks: subtasks.map((t) => t.description),
    }, subtasks.length > 1 ? 'Player goal decomposed and prepended' : 'Player task prepended');
    this.blackboardManager?.postMessage(this.botName, 'info', `Prepended task: ${description}`);
  }

  getLongTermGoal() {
    if (!this.activeLongTermGoal) return null;
    return {
      id: this.activeLongTermGoal.id,
      requestedBy: this.activeLongTermGoal.requestedBy,
      rawRequest: this.activeLongTermGoal.rawRequest,
      kind: this.activeLongTermGoal.spec.kind,
      status: this.activeLongTermGoal.status,
      buildState: this.activeLongTermGoal.buildState ?? null,
      materialRequirements: this.activeLongTermGoal.materialRequirements ?? null,
      pendingSubtasks: this.activeLongTermGoal.pendingSubtasks.map((task) => task.description),
      completedSubtasks: [...this.activeLongTermGoal.completedSubtasks],
      updatedAt: this.activeLongTermGoal.updatedAt,
    };
  }

  getLastExecutionMetrics() {
    return this.lastExecutionMetrics;
  }

  /** Get the skill library instance */
  getSkillLibrary(): SkillLibrary {
    return this.skillLibrary;
  }

  setBlackboardManager(manager: BlackboardManager): void {
    this.blackboardManager = manager;
  }

  getBlackboardManager(): BlackboardManager | null {
    return this.blackboardManager;
  }

  /** Returns a short summary of what the bot is currently doing, for chat context. */
  getInternalState(): string {
    const parts: string[] = [];
    if (this.currentTask) {
      parts.push(`Currently working on: ${this.currentTask}`);
    } else {
      parts.push('Idle, waiting for next task');
    }
    if (this.lastCompletedTask) {
      parts.push(`Just finished: ${this.lastCompletedTask}`);
    }
    if (this.lastFailedTask) {
      parts.push(`Recently failed: ${this.lastFailedTask}`);
    }
    if (this.playerTaskQueue.length > 0) {
      parts.push(`Queued tasks: ${this.playerTaskQueue.map(t => t.description).join(', ')}`);
    }
    if (this.activeLongTermGoal) {
      parts.push(`Long-term goal: ${goalSummary(this.activeLongTermGoal)}`);
    }
    return parts.join('. ');
  }

  queueLongTermGoal(description: string, requestedBy: string): void {
    this.decomposeAndSetLongTermGoal(description, requestedBy).catch((err) => {
      logger.warn({ err: err.message, goal: description }, 'Long-term goal decomposition failed, falling back to task queue');
      this.queuePlayerTask(description, requestedBy);
    });
  }

  async queueSwarmGoal(description: string, requestedBy: string): Promise<void> {
    const subtasks = await this.curriculumAgent.decomposeTask(this.bot, description);
    this.blackboardManager?.setSwarmGoal(description, requestedBy, subtasks);
    logger.info({ bot: this.botName, goal: description, requestedBy, subtasks: subtasks.map((t) => t.description) }, 'Swarm goal set');
  }

  overrideWithSwarmDirective(description: string, requestedBy: string): void {
    this.activeLongTermGoal = null;
    this.playerTaskQueue = [];
    this.activeBlackboardTask = null;
    this.codeExecutor.requestInterrupt(`swarm override: ${description}`);
    this.blackboardManager?.postMessage(this.botName, 'info', `Yielding to swarm directive from ${requestedBy}: ${description}`);
    logger.info({ bot: this.botName, goal: description, requestedBy }, 'Local directives cleared for swarm override');
  }

  queuePlayerTask(description: string, requestedBy: string): void {
    // Decompose asynchronously — subtasks get queued when ready
    this.decomposeAndQueue(description, requestedBy).catch((err) => {
      logger.warn({ err: err.message, task: description }, 'Decompose failed, queuing raw task');
      const keywords = description
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 2);
      this.playerTaskQueue.push({ description, keywords });
    });
  }

  private async decomposeAndQueue(description: string, requestedBy: string): Promise<void> {
    const subtasks = await this.curriculumAgent.decomposeTask(this.bot, description);
    for (const task of subtasks) {
      this.playerTaskQueue.push(task);
    }
    logger.info({
      bot: this.botName,
      goal: description,
      requestedBy,
      subtasks: subtasks.map((t) => t.description),
    }, subtasks.length > 1 ? 'Player goal decomposed and queued' : 'Player task queued');
    this.blackboardManager?.postMessage(this.botName, 'info', `Queued local task: ${description}`);
  }

  private async decomposeAndSetLongTermGoal(description: string, requestedBy: string): Promise<void> {
    const goal = makeLongTermGoal(description, requestedBy, []);
    if (goal.spec.kind === 'build_structure') {
      goal.buildState = 'blueprint_pending';
      const blueprint = generateSimpleHouseBlueprint(this.bot, description, this.curriculumAgent.getWorldMemory());
      const validation = validateBlueprint(this.bot, blueprint);
      if (!validation.valid) {
        throw new Error(`Generated blueprint invalid: ${validation.errors.join('; ')}`);
      }
      goal.blueprint = blueprint;
      goal.materialRequirements = countBlueprintMaterials(blueprint);
      goal.origin = this.findGroundedBuildOrigin();
      goal.buildState = 'blueprint_ready';
      this.activeLongTermGoal = goal;
      this.blackboardManager?.setBotGoal(this.botName, goal);
      logger.info({
        bot: this.botName,
        goal: description,
        requestedBy,
        blueprint: blueprint.name,
        materialRequirements: goal.materialRequirements,
        origin: goal.origin,
      }, 'Long-term build goal set');
      return;
    }

    const subtasks = await this.curriculumAgent.decomposeTask(this.bot, description);
    goal.pendingSubtasks = subtasks;
    this.activeLongTermGoal = goal;
    this.blackboardManager?.setBotGoal(this.botName, goal);
    logger.info({
      bot: this.botName,
      goal: description,
      requestedBy,
      subtasks: subtasks.map((t) => t.description),
    }, 'Long-term goal set');
  }

  private scheduleNext(): void {
    if (!this.running || this.paused) return;

    this.loopTimeout = setTimeout(async () => {
      if (!this.running || this.paused) return;

      try {
        await this.runOneCycle();
      } catch (err: any) {
        logger.error({ bot: this.botName, err: err.message }, 'Voyager cycle error');
      }

      this.scheduleNext();
    }, this.config.voyager.taskCooldownMs);
  }

  private async runOneCycle(): Promise<void> {
    if (this.paused) return;
    if (this.activeLongTermGoal?.spec.kind === 'build_structure') {
      await this.runBuildGoalCycle();
      return;
    }
    // 1. Get task from player queue or curriculum
    const goalTask = this.activeLongTermGoal ? longTermGoalToTask(this.activeLongTermGoal) : null;
    const blackboardTask = !goalTask ? (await this.blackboardManager?.claimBestTask(this.botName, this.currentTask || this.personality)) || null : null;
    this.activeBlackboardTask = blackboardTask;
    const playerTask = goalTask || this.playerTaskQueue.shift();
    const task = goalTask
      || playerTask
      || (blackboardTask ? { description: blackboardTask.description, keywords: blackboardTask.keywords } : null)
      || await this.curriculumAgent.proposeTask(
      this.bot,
      this.personality,
      this.skillLibrary
    );

    const progression = getProgressionState(this.bot, (this.curriculumAgent as any).completedTasks || []);
    const plan = buildTaskPlan(task, progression);
    this.currentTask = task.description;

    logger.info({
      bot: this.botName,
      task: task.description,
      source: goalTask ? 'long-term-goal' : playerTask ? 'player-request' : blackboardTask ? 'blackboard' : 'autonomous',
      plan: plan.steps.map((step) => step.description),
    }, 'Voyager task proposed');

    for (const step of plan.steps) {
      const ok = await this.executeTaskStep(step);
      if (!ok) {
        // If the failure was caused by an instinct pause (damage), don't treat it as
        // a real failure — just bail out so the goal resumes when instinct ends.
        if (this.paused) {
          this.currentTask = null;
          return;
        }
        const blockers = this.curriculumAgent.getBlockerMemory().getTaskBlockers({ description: step.description, keywords: step.keywords, spec: step.spec });
        const replanned = replanTaskStep({ description: step.description, keywords: step.keywords, spec: step.spec }, blockers, this.curriculumAgent.getWorldMemory());
        if (replanned) {
          logger.info({ bot: this.botName, step: step.description, replanned: replanned.steps.map((s) => s.description) }, 'Adaptive replan triggered');
          for (const replannedStep of replanned.steps) {
            const replannedOk = await this.executeTaskStep(replannedStep);
            if (!replannedOk) {
              this.currentTask = null;
              return;
            }
          }
          continue;
        }
        if (goalTask && this.activeLongTermGoal) {
          this.activeLongTermGoal.status = 'blocked';
          this.activeLongTermGoal.updatedAt = Date.now();
        }
        if (this.activeBlackboardTask) {
          this.blackboardManager?.blockTask(this.activeBlackboardTask.description, this.botName, 'step failed');
          this.activeBlackboardTask = null;
        }
        this.currentTask = null;
        return;
      }
    }
    if (goalTask && this.activeLongTermGoal) {
      const completedTask = popLongTermSubtask(this.activeLongTermGoal);
      if (completedTask) completeLongTermSubtask(this.activeLongTermGoal, completedTask);
      if (this.activeLongTermGoal.status === 'completed') {
        logger.info({ bot: this.botName, goal: this.activeLongTermGoal.rawRequest }, 'Long-term goal completed');
        this.activeLongTermGoal = null;
      }
    }
    if (this.activeBlackboardTask) {
      this.blackboardManager?.completeTask(this.activeBlackboardTask.description, this.botName);
      this.activeBlackboardTask = null;
    }
    this.currentTask = null;
  }

  private async runBuildGoalCycle(): Promise<void> {
    const goal = this.activeLongTermGoal;
    if (!goal || !goal.blueprint || !goal.origin) return;
    this.currentTask = goal.rawRequest;
    goal.buildState = 'building';

    const missing = getMissingBlueprintPlacements(this.bot, goal.blueprint, goal.origin);
    if (missing.length === 0) {
      goal.status = 'completed';
      goal.buildState = 'completed';
      if (this.bot.chat) this.bot.chat('The build is finished.');
      logger.info({ bot: this.botName, goal: goal.rawRequest }, 'Long-term build goal completed');
      this.activeLongTermGoal = null;
      this.currentTask = null;
      return;
    }

    const reserveResults = await Promise.all(missing.map(async (placement) => ({ placement, ok: await this.tryReserveBuildCell(goal.id, placement.x, placement.y, placement.z) })));
    const reservable = reserveResults.filter((r) => r.ok).map((r) => r.placement);
    const batch = (reservable.length > 0 ? reservable : missing).slice(0, 8);
    const inventoryCounts = new Map<string, number>();
    for (const item of this.bot.inventory.items()) {
      inventoryCounts.set(item.name, (inventoryCounts.get(item.name) || 0) + item.count);
    }
    const placeableNow = batch.filter((placement) => {
      if (placement.block === 'any_block') {
        return !!this.chooseAvailableBuildBlock();
      }
      return (inventoryCounts.get(placement.block) || 0) > 0;
    });
    let placedCount = 0;
    let lastError: string | null = null;
    for (const placement of (placeableNow.length > 0 ? placeableNow : batch)) {
      const blockToPlace = placement.block === 'any_block'
        ? this.chooseAvailableBuildBlock()
        : placement.block;
      if (!blockToPlace) {
        lastError = 'No suitable building block available';
        continue;
      }
      const result = await placeBlock(this.bot, blockToPlace, placement.x, placement.y, placement.z);
      if (result.success) {
        placedCount++;
        inventoryCounts.set(blockToPlace, Math.max(0, (inventoryCounts.get(blockToPlace) || 0) - 1));
      } else {
        lastError = result.message || 'placement failed';
        if (!result.message?.includes('No ') && !result.message?.includes('inventory')) {
          logger.warn({ bot: this.botName, placement, error: result.message }, 'Build placement failed without material shortage');
          continue;
        }
      }
    }

    if (placedCount > 0) {
      logger.info({ bot: this.botName, placedCount, remaining: missing.length - placedCount, goal: goal.rawRequest }, 'Build goal placed blueprint blocks');
      goal.updatedAt = Date.now();
      this.releaseBuildReservations(goal.id);
      this.currentTask = null;
      return;
    }

    const neededBlock = this.findNeededBlockForGather(batch, inventoryCounts) || missing[0]?.block;
    const gatherTask = this.createGatherTaskForBlock(neededBlock);
    if (gatherTask) {
      const now = Date.now();
      if (!goal.lastResourceNoticeAt || now - goal.lastResourceNoticeAt > 30000) {
        this.bot.chat('I need to gather more resources.');
        goal.lastResourceNoticeAt = now;
      }
      goal.buildState = 'gathering';
      logger.info({ bot: this.botName, neededBlock, task: gatherTask.description, error: lastError }, 'Build goal executing resource gathering task');
      const gatherOk = await this.executeTaskStep({ description: gatherTask.description, keywords: gatherTask.keywords, spec: gatherTask.spec });
      if (!gatherOk) {
        // If paused by instinct (damage), don't mark the build goal as blocked
        if (this.paused) {
          this.currentTask = null;
          return;
        }
        goal.status = 'blocked';
        goal.buildState = 'blocked';
        logger.warn({ bot: this.botName, goal: goal.rawRequest, gatherTask: gatherTask.description }, 'Build goal blocked while gathering resources');
      }
      this.releaseBuildReservations(goal.id);
      this.currentTask = null;
      return;
    }

    goal.status = 'blocked';
    goal.buildState = 'blocked';
    logger.warn({ bot: this.botName, goal: goal.rawRequest, error: lastError }, 'Build goal blocked');
    this.releaseBuildReservations(goal.id);
    this.currentTask = null;
  }

  private createGatherTaskForBlock(blockName?: string): Task | null {
    if (!blockName) return null;
    if (blockName === 'any_block') {
      const preferred = this.choosePreferredGatherMaterial();
      return this.createGatherTaskForBlock(preferred);
    }
    if (blockName === 'cobblestone') {
      return { description: 'Mine 20 cobblestone', keywords: ['mine', 'cobblestone', 'stone'] };
    }
    if (blockName === 'oak_planks') {
      const hasLogs = this.bot.inventory.items().some((item) => item.name === 'oak_log');
      return hasLogs
        ? { description: 'Craft 20 oak planks', keywords: ['craft', 'oak_planks', 'wood'] }
        : { description: 'Mine 6 oak logs', keywords: ['mine', 'oak_log', 'wood'] };
    }
    if (blockName === 'spruce_planks') {
      const hasLogs = this.bot.inventory.items().some((item) => item.name === 'spruce_log');
      return hasLogs
        ? { description: 'Craft 20 spruce planks', keywords: ['craft', 'spruce_planks', 'wood'] }
        : { description: 'Mine 6 spruce logs', keywords: ['mine', 'spruce_log', 'wood'] };
    }
    if (blockName === 'birch_planks') {
      const hasLogs = this.bot.inventory.items().some((item) => item.name === 'birch_log');
      return hasLogs
        ? { description: 'Craft 20 birch planks', keywords: ['craft', 'birch_planks', 'wood'] }
        : { description: 'Mine 6 birch logs', keywords: ['mine', 'birch_log', 'wood'] };
    }
    return null;
  }

  private findGroundedBuildOrigin(): { x: number; y: number; z: number } {
    const base = this.bot.entity.position.floored();
    const startX = Math.round(base.x + 2);
    const startZ = Math.round(base.z + 2);
    for (let y = Math.floor(base.y); y >= Math.max(1, Math.floor(base.y) - 20); y--) {
      const below = this.bot.blockAt(new Vec3(startX, y, startZ));
      const above = this.bot.blockAt(new Vec3(startX, y + 1, startZ));
      if (below && !['air', 'cave_air', 'void_air'].includes(below.name) && (!above || ['air', 'cave_air', 'void_air'].includes(above.name))) {
        return { x: startX, y: y + 1, z: startZ };
      }
    }
    return { x: Math.round(base.x + 2), y: Math.round(base.y), z: Math.round(base.z + 2) };
  }

  private findNeededBlockForGather(batch: Array<{ block: string }>, inventoryCounts: Map<string, number>): string | undefined {
    for (const placement of batch) {
      if (placement.block === 'any_block') {
        if (!this.chooseAvailableBuildBlock()) return 'any_block';
        continue;
      }
      if ((inventoryCounts.get(placement.block) || 0) <= 0) {
        return placement.block;
      }
    }
    return undefined;
  }

  private chooseAvailableBuildBlock(): string | null {
    const buildable = [
      'oak_planks',
      'spruce_planks',
      'birch_planks',
      'cobblestone',
      'dirt',
      'stone',
    ];
    const inventory = new Map<string, number>();
    for (const item of this.bot.inventory.items()) {
      inventory.set(item.name, (inventory.get(item.name) || 0) + item.count);
    }
    for (const block of buildable) {
      if ((inventory.get(block) || 0) > 0) return block;
    }
    return null;
  }

  private choosePreferredGatherMaterial(): string {
    const inventory = new Set(this.bot.inventory.items().map((item) => item.name));
    if (inventory.has('oak_log') || this.curriculumAgent.getWorldMemory().findNearest('oak_log', 'resource')) return 'oak_planks';
    if (inventory.has('spruce_log') || this.curriculumAgent.getWorldMemory().findNearest('spruce_log', 'resource')) return 'spruce_planks';
    if (inventory.has('birch_log') || this.curriculumAgent.getWorldMemory().findNearest('birch_log', 'resource')) return 'birch_planks';
    if (inventory.has('cobblestone')) return 'cobblestone';
    return 'oak_planks';
  }

  private async tryReserveBuildCell(goalId: string, x: number, y: number, z: number): Promise<boolean> {
    if (!this.blackboardManager) return true;
    return this.blackboardManager.claimReservation('build-cell', `${goalId}:${x},${y},${z}`, this.botName, goalId, 45000);
  }

  private releaseBuildReservations(goalId: string): void {
    this.blackboardManager?.releaseReservationsForBot(this.botName, `${goalId}:`);
  }

  private async executeTaskStep(step: PlannedStep): Promise<boolean> {
    const task: Task = { description: step.description, keywords: step.keywords, spec: step.spec };
    this.currentTask = task.description;
    this.blackboardManager?.postMessage(this.botName, 'progress', `Working on ${task.description}.`);

    // 2. Try the best existing skill first, then fall back to fresh generation
    if (!this.actionAgent) {
      logger.info({ bot: this.botName }, 'No LLM available, skipping task');
      return false;
    }

    const query = task.keywords.join(' ') + ' ' + task.description;
    const bestSkill = await this.skillLibrary.getBestMatch(query);
    const composableSkills = await this.skillLibrary.getComposableMatches(query, 3);
    const blockerSummary = this.curriculumAgent.getBlockerMemory().summarize(task);
    const worldMemorySummary = this.curriculumAgent.getWorldMemory().summary();
    const useDirectSkill = !!bestSkill && composableSkills.length <= 1;
    let generated = useDirectSkill
      ? this.skillToGeneratedCode(bestSkill)
      : await this.actionAgent.generateCode(this.bot, task, this.skillLibrary, undefined, undefined, undefined, undefined, blockerSummary, worldMemorySummary);

    logger.info({
      bot: this.botName,
      source: useDirectSkill ? 'skill-library' : 'action-agent',
      skillName: bestSkill?.name,
      skillScore: bestSkill?.score,
      composableSkills: composableSkills.map((skill) => ({ name: skill.name, score: skill.score })),
      functionName: generated.functionName,
      codeLength: generated.functionCode.length,
      execCode: generated.execCode,
    }, useDirectSkill ? 'Reusing saved skill' : 'Code generated by ActionAgent');

    logger.debug({
      bot: this.botName,
      functionName: generated.functionName,
      code: generated.functionCode,
    }, 'Generated code body');

    // 3. Execute with retries
    let lastError: string | undefined;
    let eventLog = '';
    for (let attempt = 0; attempt < this.config.voyager.maxRetriesPerTask; attempt++) {
      if (!this.running) return false;

      const preState = takeBotSnapshot(this.bot);

      // Get ALL skill code for VM injection (so new code can call prior skills)
      const allSkillCode = this.skillLibrary.getAllSkillCode();

      logger.info({ bot: this.botName, attempt: attempt + 1 }, 'Executing generated code');
      const execResult = await this.codeExecutor.execute(this.bot, {
        functionCode: generated.functionCode,
        execCode: generated.execCode,
        allSkillCode,
      });

      if (execResult.error?.startsWith('Execution interrupted:')) {
        logger.warn({ bot: this.botName, task: task.description, reason: execResult.error }, 'Voyager task interrupted');
        return false;
      }

      logger.info({
        bot: this.botName,
        execSuccess: execResult.success,
        execError: execResult.error,
        execOutputPreview: execResult.output.slice(0, 2000),
        execOutputLength: execResult.output.length,
        execEventsCount: execResult.events.length,
      }, 'Execution result');
      logger.debug({
        bot: this.botName,
        execOutput: execResult.output.slice(0, 4000),
        execEvents: execResult.events.slice(0, 40),
        execEventsTruncated: Math.max(0, execResult.events.length - 40),
      }, 'Execution result details');
      this.statsTracker.trackExecution(this.botName, execResult.events);
      eventLog = execResult.events
        .slice(0, 30)
        .map((event) => `${event.type}: ${event.message}`)
        .join(' | ')
        .slice(0, VoyagerLoop.MAX_RETRY_EVENT_LOG_CHARS);
      this.lastExecutionMetrics = {
        attempt: attempt + 1,
        task: task.description,
        success: execResult.success,
        outputLength: execResult.output.length,
        eventCount: execResult.events.length,
        eventLogLength: eventLog.length,
        codeLength: generated.functionCode.length,
        timestamp: Date.now(),
      };

      // Wait for actions to settle
      await new Promise((r) => setTimeout(r, 2000));

      const postState = takeBotSnapshot(this.bot);
      await this.curriculumAgent.getWorldMemory().rememberFromBot(this.bot);

      // 4. Critic evaluation
      const criticResult = await this.criticAgent.evaluate(
        this.bot,
        task,
        execResult,
        preState,
        postState
      );

      logger.info({
        bot: this.botName,
        task: task.description,
        attempt: attempt + 1,
        success: criticResult.success,
        reason: criticResult.reason,
      }, 'Voyager task evaluated');

      if (criticResult.success) {
        // Save the named function as a reusable skill
        const skillName = this.taskToSkillName(task);
        const quality = this.estimateSkillQuality(criticResult.reason, generated.functionCode);
        if (quality >= 0.65) {
          await this.skillLibrary.save(
            skillName,
            task.description,
            task.keywords,
            generated.functionCode,
            quality
          );
          this.skillLibrary.recordOutcome(skillName, true);
        }
        this.curriculumAgent.updateProgress(task, true);
        this.curriculumAgent.getBlockerMemory().clearTask(task);
        this.lastCompletedTask = task.description;
        this.blackboardManager?.postMessage(this.botName, 'completion', `Finished ${task.description}.`);
        return true;
      }

      // Retry with iterative refinement
      lastError = criticResult.reason;
      if (useDirectSkill && bestSkill) {
        this.skillLibrary.recordOutcome(bestSkill.name, false);
      }
        if (attempt < this.config.voyager.maxRetriesPerTask - 1) {
        logger.info({ bot: this.botName, attempt: attempt + 1, critique: criticResult.critique, previousSource: useDirectSkill ? 'skill-library' : 'action-agent' }, 'Retrying with error feedback');
        generated = await this.actionAgent.generateCode(
          this.bot, task, this.skillLibrary,
          lastError, generated.functionCode, criticResult.critique, eventLog, blockerSummary, worldMemorySummary
        );
        logger.info({
          bot: this.botName,
          source: 'action-agent',
          functionName: generated.functionName,
          codeLength: generated.functionCode.length,
          execCode: generated.execCode,
        }, 'Code generated by ActionAgent');
        logger.debug({
          bot: this.botName,
          functionName: generated.functionName,
          code: generated.functionCode,
        }, 'Retry generated code body');
      }
    }

    this.curriculumAgent.updateProgress(task, false);
    this.curriculumAgent.getBlockerMemory().recordTaskFailure(task, {
      success: false,
      output: eventLog.slice(0, VoyagerLoop.MAX_FAILURE_OUTPUT_CHARS),
      error: lastError,
      events: [],
    }, lastError || 'task failed');
    this.lastFailedTask = task.description;
    this.blackboardManager?.postMessage(this.botName, 'blocker', `${task.description} failed: ${lastError || 'unknown error'}`);
    logger.warn({ bot: this.botName, task: task.description, lastError }, 'Task failed after max retries');
    return false;
  }

  private taskToSkillName(task: Task): string {
    return task.description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 5)
      .join('_');
  }

  private skillToGeneratedCode(skill: SkillMatch): GeneratedCode {
    const nameMatch = skill.code.match(/^async\s+function\s+(\w+)\s*\(/m);
    const functionName = nameMatch?.[1] || skill.name;
    return {
      functionName,
      functionCode: skill.code,
      execCode: `await ${functionName}(bot);`,
    };
  }

  private estimateSkillQuality(reason: string, code: string): number {
    let quality = 0.75;
    if (reason.toLowerCase().includes('inventory changed') || reason.toLowerCase().includes('crafted') || reason.toLowerCase().includes('collected')) {
      quality += 0.1;
    }
    if (code.length > 2000) {
      quality -= 0.1;
    }
    if (code.includes('generatedTask')) {
      quality -= 0.15;
    }
    return Math.max(0, Math.min(1, quality));
  }
}
