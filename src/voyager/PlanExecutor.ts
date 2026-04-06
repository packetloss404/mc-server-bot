import { Bot } from 'mineflayer';
import { CodeExecutor, ExecutionResult } from './CodeExecutor';
import { logger } from '../util/logger';

export interface ActionStep {
  action: string;
  args: Record<string, unknown>;
  description?: string;
}

export interface ActionPlan {
  steps: ActionStep[];
  description: string;
}

export interface StepResult {
  step: ActionStep;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface PlanExecutionResult {
  success: boolean;
  completedSteps: number;
  totalSteps: number;
  results: StepResult[];
  error?: string;
  output: string;
  events: Array<{ type: string; message: string }>;
}

interface ActionDef {
  requiredArgs: string[];
  toCode: (args: Record<string, unknown>) => string;
}

const ACTION_REGISTRY: Record<string, ActionDef> = {
  mineBlock: {
    requiredArgs: ['blockName'],
    toCode: (a) => `await mineBlock(${JSON.stringify(a.blockName)}, ${Number(a.count ?? 1)});`,
  },
  craftItem: {
    requiredArgs: ['itemName'],
    toCode: (a) => `await craftItem(${JSON.stringify(a.itemName)}, ${Number(a.count ?? 1)});`,
  },
  walkTo: {
    requiredArgs: ['x', 'y', 'z'],
    toCode: (a) => `await moveTo(${Number(a.x)}, ${Number(a.y)}, ${Number(a.z)}, ${Number(a.range ?? 2)}, ${Number(a.timeoutSec ?? 15)});`,
  },
  placeBlock: {
    requiredArgs: ['blockName', 'x', 'y', 'z'],
    toCode: (a) => `await placeItem(${JSON.stringify(a.blockName)}, ${Number(a.x)}, ${Number(a.y)}, ${Number(a.z)});`,
  },
  depositItem: {
    requiredArgs: ['itemName'],
    toCode: (a) => {
      const container = a.containerName ?? 'chest';
      return `await depositItem(${JSON.stringify(container)}, ${JSON.stringify(a.itemName)}, ${Number(a.count ?? 1)});`;
    },
  },
  withdrawItem: {
    requiredArgs: ['itemName'],
    toCode: (a) => {
      const container = a.containerName ?? 'chest';
      return `await withdrawItem(${JSON.stringify(container)}, ${JSON.stringify(a.itemName)}, ${Number(a.count ?? 1)});`;
    },
  },
  equipItem: {
    requiredArgs: ['itemName'],
    toCode: (a) => {
      return [
        `const __item = bot.inventory.items().find(i => i.name === ${JSON.stringify(a.itemName)});`,
        `if (!__item) throw new Error("Item not in inventory: " + ${JSON.stringify(a.itemName)});`,
        `await bot.equip(__item, ${JSON.stringify(a.destination ?? 'hand')});`,
      ].join('\n');
    },
  },
  eatFood: {
    requiredArgs: [],
    toCode: () => {
      return [
        `const __foods = bot.inventory.items().filter(i => {`,
        `  const edible = ["bread","cooked_beef","cooked_porkchop","cooked_chicken","cooked_mutton",`,
        `    "cooked_rabbit","cooked_salmon","cooked_cod","baked_potato","apple","golden_apple",`,
        `    "golden_carrot","melon_slice","sweet_berries","carrot","potato","beetroot","cookie",`,
        `    "pumpkin_pie","mushroom_stew","rabbit_stew","beetroot_soup","dried_kelp"];`,
        `  return edible.includes(i.name);`,
        `});`,
        `if (__foods.length === 0) throw new Error("No food in inventory");`,
        `await bot.equip(__foods[0], "hand");`,
        `// wait briefly for eating`,
        `await bot.waitForTicks(40);`,
      ].join('\n');
    },
  },
  attackNearest: {
    requiredArgs: ['entityType'],
    toCode: (a) => `await killMob(${JSON.stringify(a.entityType)}, ${Number(a.maxDuration ?? 30000)});`,
  },
  followPlayer: {
    requiredArgs: ['playerName'],
    toCode: (a) => {
      return [
        `const __player = bot.players[${JSON.stringify(a.playerName)}];`,
        `if (!__player || !__player.entity) throw new Error("Player not found or not nearby: " + ${JSON.stringify(a.playerName)});`,
        `await moveTo(__player.entity.position.x, __player.entity.position.y, __player.entity.position.z, ${Number(a.range ?? 3)}, ${Number(a.timeoutSec ?? 15)});`,
      ].join('\n');
    },
  },
  exploreDirection: {
    requiredArgs: ['direction'],
    toCode: (a) => {
      const dir = a.direction as Record<string, number> | string;
      let dirObj: { x: number; y: number; z: number };
      if (typeof dir === 'string') {
        const dirMap: Record<string, { x: number; y: number; z: number }> = {
          north: { x: 0, y: 0, z: -1 },
          south: { x: 0, y: 0, z: 1 },
          east:  { x: 1, y: 0, z: 0 },
          west:  { x: -1, y: 0, z: 0 },
          up:    { x: 0, y: 1, z: 0 },
          down:  { x: 0, y: -1, z: 0 },
        };
        dirObj = dirMap[dir.toLowerCase()] ?? { x: 1, y: 0, z: 0 };
      } else {
        dirObj = { x: Number(dir.x ?? 1), y: Number(dir.y ?? 0), z: Number(dir.z ?? 0) };
      }
      const blocks = Number(a.blocks ?? 60);
      return `await exploreUntil(${JSON.stringify(dirObj)}, ${blocks}, () => null);`;
    },
  },
  smeltItem: {
    requiredArgs: ['itemName', 'fuelName'],
    toCode: (a) => `await smeltItem(${JSON.stringify(a.itemName)}, ${JSON.stringify(a.fuelName)}, ${Number(a.count ?? 1)});`,
  },
  inspectContainer: {
    requiredArgs: ['containerName'],
    toCode: (a) => `await inspectContainer(${JSON.stringify(a.containerName)});`,
  },
};

export class PlanExecutor {
  private bot: Bot;
  private timeoutMs: number;
  private codeExecutor: CodeExecutor;

  constructor(bot: Bot, timeoutMs: number) {
    this.bot = bot;
    this.timeoutMs = timeoutMs;
    this.codeExecutor = new CodeExecutor(timeoutMs);
  }

  /**
   * Convert an ActionStep into a JavaScript code string that can be
   * executed by CodeExecutor. This is the bridge between structured
   * plans and the existing execution infrastructure.
   */
  stepToCode(step: ActionStep): string {
    const def = ACTION_REGISTRY[step.action];
    if (!def) {
      throw new Error(`Unknown action: "${step.action}". Available: ${Object.keys(ACTION_REGISTRY).join(', ')}`);
    }

    // Validate required args
    for (const arg of def.requiredArgs) {
      if (!(arg in step.args)) {
        throw new Error(
          `Action "${step.action}" requires argument "${arg}". Provided: ${Object.keys(step.args).join(', ') || 'none'}`
        );
      }
    }

    return def.toCode(step.args);
  }

  /**
   * Execute a structured ActionPlan step by step.
   * Fails fast on the first step error and returns partial results.
   */
  async execute(plan: ActionPlan): Promise<PlanExecutionResult> {
    const results: StepResult[] = [];
    const allEvents: Array<{ type: string; message: string }> = [];
    const outputLines: string[] = [];

    logger.info(
      { planDescription: plan.description, totalSteps: plan.steps.length },
      'PlanExecutor starting plan'
    );

    allEvents.push({ type: 'plan_start', message: `Starting plan: ${plan.description} (${plan.steps.length} steps)` });

    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepLabel = `[step ${i + 1}/${plan.steps.length}]`;
      const desc = step.description || `${step.action}(${JSON.stringify(step.args)})`;

      logger.info({ step: i + 1, action: step.action, args: step.args, description: desc }, 'PlanExecutor executing step');
      allEvents.push({ type: 'step_start', message: `${stepLabel} ${desc}` });

      // Validate and convert to code
      let code: string;
      try {
        code = this.stepToCode(step);
      } catch (err: any) {
        const errorMsg = err.message || String(err);
        logger.warn({ step: i + 1, action: step.action, error: errorMsg }, 'PlanExecutor step validation failed');
        allEvents.push({ type: 'step_error', message: `${stepLabel} Validation failed: ${errorMsg}` });
        results.push({
          step,
          success: false,
          error: errorMsg,
          durationMs: 0,
        });
        outputLines.push(`${stepLabel} FAILED (validation): ${errorMsg}`);
        return {
          success: false,
          completedSteps: i,
          totalSteps: plan.steps.length,
          results,
          error: `Step ${i + 1} validation failed: ${errorMsg}`,
          output: outputLines.join('\n'),
          events: allEvents,
        };
      }

      // Execute the code via CodeExecutor
      const startTime = Date.now();
      let execResult: ExecutionResult;
      try {
        execResult = await this.codeExecutor.execute(this.bot, code);
      } catch (err: any) {
        const errorMsg = err.message || String(err);
        const durationMs = Date.now() - startTime;
        logger.warn({ step: i + 1, action: step.action, error: errorMsg, durationMs }, 'PlanExecutor step threw');
        allEvents.push({ type: 'step_error', message: `${stepLabel} Exception: ${errorMsg}` });
        results.push({ step, success: false, error: errorMsg, durationMs });
        outputLines.push(`${stepLabel} FAILED (exception): ${errorMsg}`);
        return {
          success: false,
          completedSteps: i,
          totalSteps: plan.steps.length,
          results,
          error: `Step ${i + 1} threw: ${errorMsg}`,
          output: outputLines.join('\n'),
          events: allEvents,
        };
      }

      const durationMs = Date.now() - startTime;

      // Collect events from the code execution
      for (const evt of execResult.events) {
        allEvents.push({ type: evt.type, message: evt.message });
      }

      if (execResult.success) {
        logger.info({ step: i + 1, action: step.action, durationMs }, 'PlanExecutor step succeeded');
        allEvents.push({ type: 'step_success', message: `${stepLabel} completed in ${durationMs}ms` });
        results.push({ step, success: true, durationMs });
        outputLines.push(`${stepLabel} OK (${durationMs}ms): ${desc}`);
        if (execResult.output) {
          outputLines.push(execResult.output);
        }
      } else {
        const errorMsg = execResult.error || 'Step execution failed';
        logger.warn({ step: i + 1, action: step.action, error: errorMsg, durationMs }, 'PlanExecutor step failed');
        allEvents.push({ type: 'step_failure', message: `${stepLabel} failed: ${errorMsg}` });
        results.push({ step, success: false, error: errorMsg, durationMs });
        outputLines.push(`${stepLabel} FAILED (${durationMs}ms): ${errorMsg}`);
        if (execResult.output) {
          outputLines.push(execResult.output);
        }
        return {
          success: false,
          completedSteps: i,
          totalSteps: plan.steps.length,
          results,
          error: `Step ${i + 1} failed: ${errorMsg}`,
          output: outputLines.join('\n'),
          events: allEvents,
        };
      }
    }

    const totalCompleted = plan.steps.length;
    logger.info(
      { planDescription: plan.description, completedSteps: totalCompleted },
      'PlanExecutor plan completed successfully'
    );
    allEvents.push({ type: 'plan_complete', message: `Plan completed: ${totalCompleted}/${totalCompleted} steps` });

    return {
      success: true,
      completedSteps: totalCompleted,
      totalSteps: totalCompleted,
      results,
      output: outputLines.join('\n'),
      events: allEvents,
    };
  }
}
