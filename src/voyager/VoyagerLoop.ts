import { Bot } from 'mineflayer';
import { LLMClient } from '../ai/LLMClient';
import { Config } from '../config';
import { SkillLibrary } from './SkillLibrary';
import { CodeExecutor } from './CodeExecutor';
import { CurriculumAgent, Task } from './CurriculumAgent';
import { ActionAgent, GeneratedCode } from './ActionAgent';
import { CriticAgent, takeBotSnapshot } from './CriticAgent';
import { logger } from '../util/logger';

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
  private running = false;
  private paused = false;
  private loopTimeout: NodeJS.Timeout | null = null;
  private playerTaskQueue: Task[] = [];

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

    this.skillLibrary = new SkillLibrary(config.skills.directory, config.skills.maxSkills);
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

  queuePlayerTask(description: string, requestedBy: string): void {
    const keywords = description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);

    const task: Task = { description, keywords };
    this.playerTaskQueue.push(task);
    logger.info({ bot: this.botName, task: description, requestedBy }, 'Player task queued');
  }

  private scheduleNext(): void {
    if (!this.running || this.paused) return;

    this.loopTimeout = setTimeout(async () => {
      if (!this.running) return;

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

    this.currentTask = task.description;

    logger.info({
      bot: this.botName,
      task: task.description,
      source: playerTask ? 'player-request' : 'autonomous',
    }, 'Voyager task proposed');

    // 2. ALWAYS generate code via ActionAgent (no skill short-circuit)
    if (!this.actionAgent) {
      logger.info({ bot: this.botName }, 'No LLM available, skipping task');
      return;
    }

    let generated = await this.actionAgent.generateCode(this.bot, task, this.skillLibrary);

      logger.info({
        bot: this.botName,
        functionName: generated.functionName,
        codeLength: generated.functionCode.length,
        code: generated.functionCode,
        execCode: generated.execCode,
      }, 'Code generated by ActionAgent');

    // 3. Execute with retries
    let lastError: string | undefined;
    for (let attempt = 0; attempt < this.config.voyager.maxRetriesPerTask; attempt++) {
      if (!this.running) return;

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
        this.currentTask = null;
        return;
      }

      logger.info({
        bot: this.botName,
        execSuccess: execResult.success,
        execError: execResult.error,
        execOutput: execResult.output,
      }, 'Execution result');

      // Wait for actions to settle
      await new Promise((r) => setTimeout(r, 2000));

      const postState = takeBotSnapshot(this.bot);

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
        this.skillLibrary.save(
          this.taskToSkillName(task),
          task.description,
          task.keywords,
          generated.functionCode
        );
        this.curriculumAgent.updateProgress(task, true);
        this.lastCompletedTask = task.description;
        this.currentTask = null;
        return;
      }

      // Retry with iterative refinement
      lastError = criticResult.reason;
      if (attempt < this.config.voyager.maxRetriesPerTask - 1) {
        logger.info({ bot: this.botName, attempt: attempt + 1, critique: criticResult.critique }, 'Retrying with error feedback');
        generated = await this.actionAgent.generateCode(
          this.bot, task, this.skillLibrary,
          lastError, generated.functionCode, criticResult.critique
        );
      }
    }

    this.curriculumAgent.updateProgress(task, false);
    this.lastFailedTask = task.description;
    this.currentTask = null;
    logger.warn({ bot: this.botName, task: task.description, lastError }, 'Task failed after max retries');
  }

  private taskToSkillName(task: Task): string {
    return task.description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .slice(0, 5)
      .join('_');
  }
}
