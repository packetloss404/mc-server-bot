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

export type ChatCallback = (message: string) => void;

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
  private chatCallback: ChatCallback | null = null;

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

  /** Get the skill library instance */
  getSkillLibrary(): SkillLibrary {
    return this.skillLibrary;
  }

  getQueuedTaskCount(): number {
    return this.playerTaskQueue.length;
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
    return parts.join('. ');
  }

  /** Set a callback to send chat messages to the player during task execution */
  setChatCallback(callback: ChatCallback | null): void {
    this.chatCallback = callback;
  }

  private sendChat(message: string): void {
    if (this.chatCallback) {
      this.chatCallback(message);
    }
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
    // 1. Get task from player queue or curriculum
    const playerTask = this.playerTaskQueue.shift();
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
      source: playerTask ? 'player-request' : 'autonomous',
      plan: plan.steps.map((step) => step.description),
    }, 'Voyager task proposed');

    const isPlayerRequest = !!playerTask;

    for (const step of plan.steps) {
      const ok = await this.executeTaskStep(step, isPlayerRequest);
      if (!ok) {
        const blockers = this.curriculumAgent.getBlockerMemory().getTaskBlockers({ description: step.description, keywords: step.keywords, spec: step.spec });
        const replanned = replanTaskStep({ description: step.description, keywords: step.keywords, spec: step.spec }, blockers, this.curriculumAgent.getWorldMemory());
        if (replanned) {
          logger.info({ bot: this.botName, step: step.description, replanned: replanned.steps.map((s) => s.description) }, 'Adaptive replan triggered');
          for (const replannedStep of replanned.steps) {
            const replannedOk = await this.executeTaskStep(replannedStep, isPlayerRequest);
            if (!replannedOk) {
              this.currentTask = null;
              return;
            }
          }
          continue;
        }
        this.currentTask = null;
        return;
      }
    }
    this.currentTask = null;
  }

  private async executeTaskStep(step: PlannedStep, verbose = false): Promise<boolean> {
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

    if (verbose) {
      if (useDirectSkill) {
        this.sendChat(`I know how to do this! Using saved skill...`);
      } else {
        this.sendChat(`Generating code for: ${task.description}...`);
      }
    }

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
          if (verbose && !useDirectSkill) {
            this.sendChat(`Skill learned and saved! I'll remember how to do this next time.`);
          }
        }
        if (verbose) {
          this.sendChat(`Done: ${task.description}`);
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
    if (verbose) {
      this.sendChat(`Sorry, I couldn't complete: ${task.description}`);
    }
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
