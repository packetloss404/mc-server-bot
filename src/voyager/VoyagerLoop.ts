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

export class VoyagerLoop {
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
  private playerTaskQueue: Task[] = [];
  private activeLongTermGoal: LongTermGoal | null = null;

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

  /** Get the skill library instance */
  getSkillLibrary(): SkillLibrary {
    return this.skillLibrary;
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
    const playerTask = goalTask || this.playerTaskQueue.shift();
    const task = playerTask || await this.curriculumAgent.proposeTask(
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
      source: goalTask ? 'long-term-goal' : playerTask ? 'player-request' : 'autonomous',
      plan: plan.steps.map((step) => step.description),
    }, 'Voyager task proposed');

    for (const step of plan.steps) {
      const ok = await this.executeTaskStep(step);
      if (!ok) {
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

    const batch = missing.slice(0, 8);
    const inventoryCounts = new Map<string, number>();
    for (const item of this.bot.inventory.items()) {
      inventoryCounts.set(item.name, (inventoryCounts.get(item.name) || 0) + item.count);
    }
    const placeableNow = batch.filter((placement) => (inventoryCounts.get(placement.block) || 0) > 0);
    let placedCount = 0;
    let lastError: string | null = null;
    for (const placement of (placeableNow.length > 0 ? placeableNow : batch)) {
      const result = await placeBlock(this.bot, placement.block, placement.x, placement.y, placement.z);
      if (result.success) {
        placedCount++;
        inventoryCounts.set(placement.block, Math.max(0, (inventoryCounts.get(placement.block) || 0) - 1));
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
        goal.status = 'blocked';
        goal.buildState = 'blocked';
        logger.warn({ bot: this.botName, goal: goal.rawRequest, gatherTask: gatherTask.description }, 'Build goal blocked while gathering resources');
      }
      this.currentTask = null;
      return;
    }

    goal.status = 'blocked';
    goal.buildState = 'blocked';
    logger.warn({ bot: this.botName, goal: goal.rawRequest, error: lastError }, 'Build goal blocked');
    this.currentTask = null;
  }

  private createGatherTaskForBlock(blockName?: string): Task | null {
    if (!blockName) return null;
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
      if ((inventoryCounts.get(placement.block) || 0) <= 0) {
        return placement.block;
      }
    }
    return undefined;
  }

  private async executeTaskStep(step: PlannedStep): Promise<boolean> {
    const task: Task = { description: step.description, keywords: step.keywords, spec: step.spec };
    this.currentTask = task.description;

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
      code: generated.functionCode,
      execCode: generated.execCode,
    }, useDirectSkill ? 'Reusing saved skill' : 'Code generated by ActionAgent');

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
        execOutput: execResult.output,
        execEvents: execResult.events,
      }, 'Execution result');
      this.statsTracker.trackExecution(this.botName, execResult.events);
      eventLog = execResult.events.map((event) => `${event.type}: ${event.message}`).join(' | ');

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
          code: generated.functionCode,
          execCode: generated.execCode,
        }, 'Code generated by ActionAgent');
      }
    }

    this.curriculumAgent.updateProgress(task, false);
    this.curriculumAgent.getBlockerMemory().recordTaskFailure(task, {
      success: false,
      output: eventLog,
      error: lastError,
      events: [],
    }, lastError || 'task failed');
    this.lastFailedTask = task.description;
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
