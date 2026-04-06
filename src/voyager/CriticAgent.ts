import { Bot } from 'mineflayer';
import { LLMClient } from '../ai/LLMClient';
import { Task } from './CurriculumAgent';
import { ExecutionResult } from './CodeExecutor';
import { renderObservation, formatObservation } from './Observation';
import { buildTaskGuidance } from './TaskGuidance';
import { extractTaskGoal, runSuccessChecks } from './SuccessChecks';
import { logger } from '../util/logger';

export interface CriticResult {
  success: boolean;
  reason: string;
  critique: string; // feedback for the action agent on retry
}

const CRITIC_SYSTEM_PROMPT = `You are an assistant that assesses a Minecraft bot's progress and provides useful guidance.

You are required to evaluate if the bot has met the task requirements. Exceeding the task requirements is also considered a success while failing to meet them requires you to provide critique to help improve.

You will receive the following information:

Biome: The biome after task execution.
Time: The current time.
Nearby blocks: The surrounding blocks. These blocks are not collected yet. However, this is useful for some placing or planting tasks.
Health: The bot's current health.
Hunger: The bot's current hunger level. For eating tasks, if hunger is 20.0, the bot successfully ate the food.
Position: The bot's current position.
Equipment: The bot's final equipment. For crafting tasks, the bot sometimes equips the crafted item.
Inventory (xx/36): The bot's final inventory. For mining and smelting tasks, you only need to check inventory.
Inventory delta: Items gained or lost during execution. Positive means gained, negative means consumed.
Task: The objective to accomplish.

You should only respond in JSON format as described below:
{"reasoning": "reasoning", "success": boolean, "critique": "critique"}
Ensure the response can be parsed by JSON.parse(), e.g.: no trailing commas, no single quotes, etc.
Do NOT wrap in markdown fences.

Here are some examples:
INPUT:
Inventory (2/36): {"raw_iron": 5, "stone_pickaxe": 1}
Task: Mine 5 iron_ore
RESPONSE:
{"reasoning": "Mining iron_ore yields raw_iron. The bot has 5 raw_iron in inventory.", "success": true, "critique": ""}

INPUT:
Inventory (3/36): {"crafting_table": 1, "spruce_planks": 6, "stick": 4}
Task: Craft a wooden pickaxe
RESPONSE:
{"reasoning": "The bot has materials but did not craft the pickaxe.", "success": false, "critique": "Craft a wooden pickaxe with a crafting table using 3 spruce planks and 2 sticks."}

INPUT:
Position before: 100, 65, 200
Position after: 145, 68, 220
Distance moved: 52.3
Task: Explore 50 blocks to the north
RESPONSE:
{"reasoning": "The bot moved 52.3 blocks, exceeding the required 50.", "success": true, "critique": ""}

INPUT:
Inventory delta: none
Position before: 100, 65, 200
Position after: 100, 65, 200
Task: Mine 3 cobblestone
RESPONSE:
{"reasoning": "No inventory change and no movement occurred. The bot did not mine anything.", "success": false, "critique": "Use mineBlock('cobblestone', 3) to mine cobblestone. If no cobblestone is nearby, first use exploreUntil to find stone blocks, then mine them."}

INPUT:
Inventory delta: oak_log:+3, oak_planks:+4, stick:+8, crafting_table:+1
Task: Mine 3 oak logs
RESPONSE:
{"reasoning": "The inventory delta shows oak_log:+3. The bot exceeded requirements by also crafting planks and sticks.", "success": true, "critique": ""}`;

export class CriticAgent {
  private llmClient: LLMClient | null;
  private useLLM: boolean;

  constructor(llmClient: LLMClient | null, useLLM: boolean) {
    this.llmClient = llmClient;
    this.useLLM = useLLM && !!llmClient;
  }

  async evaluate(
    bot: Bot,
    task: Task,
    executionResult: ExecutionResult,
    preState: BotSnapshot,
    postState: BotSnapshot
  ): Promise<CriticResult> {
    // If code errored, always fail
    if (!executionResult.success) {
      return {
        success: false,
        reason: executionResult.error || 'Code execution failed',
        critique: `The code threw an error: ${executionResult.error}. Fix the error and try again.`,
      };
    }

    const shouldPreferSemanticCritic = this.shouldPreferSemanticCritic(task);

    // Programmatic checks first (strict)
    if (!shouldPreferSemanticCritic) {
      const programmatic = this.programmaticCheck(task, executionResult, preState, postState);
      if (programmatic) return programmatic;
    }

    // LLM check with rich observation (closer to original Voyager)
    if (this.useLLM && this.llmClient) {
      return this.llmCheck(bot, task, executionResult, preState, postState);
    }

    // Default: trust the execution result but with empty critique
    return {
      success: executionResult.success,
      reason: executionResult.success ? 'Code executed without errors' : 'Unknown error',
      critique: '',
    };
  }

  private programmaticCheck(
    task: Task,
    executionResult: ExecutionResult,
    preState: BotSnapshot,
    postState: BotSnapshot
  ): CriticResult | null {
    const distanceMoved = preState.position.distanceTo(postState.position);
    const itemsChanged = preState.itemCount !== postState.itemCount;
    const goal = extractTaskGoal(task.description);
    const targetDelta = goal.item ? (postState.inventory[goal.item] || 0) - (preState.inventory[goal.item] || 0) : 0;

    logger.info({
      task: task.description,
      prePosition: `${preState.position.x.toFixed(1)},${preState.position.y.toFixed(1)},${preState.position.z.toFixed(1)}`,
      postPosition: `${postState.position.x.toFixed(1)},${postState.position.y.toFixed(1)},${postState.position.z.toFixed(1)}`,
      distanceMoved: Number(distanceMoved.toFixed(2)),
      preItemCount: preState.itemCount,
      postItemCount: postState.itemCount,
      itemsChanged,
      targetItem: goal.item,
      targetCount: goal.count,
      targetDelta,
      nearbyBlocksBefore: preState.nearbyBlocks,
      nearbyBlocksAfter: postState.nearbyBlocks,
      nearbyEntitiesBefore: preState.nearbyEntities,
      nearbyEntitiesAfter: postState.nearbyEntities,
      preHealth: preState.health,
      postHealth: postState.health,
      preHunger: preState.hunger,
      postHunger: postState.hunger,
      preOxygen: preState.oxygen,
      postOxygen: postState.oxygen,
    }, 'Critic state diff');
    const result = runSuccessChecks(task, executionResult, preState, postState);
    if (result) {
      logger.info({ task: task.description, result: result.success, reason: result.reason }, 'Critic programmatic decision');
    }
    return result;
  }

  private async llmCheck(
    bot: Bot,
    task: Task,
    executionResult: ExecutionResult,
    preState: BotSnapshot,
    postState: BotSnapshot
  ): Promise<CriticResult> {
    try {
      logger.info({ task: task.description }, 'Critic falling back to LLM evaluation');
      const obs = renderObservation(bot);

      // Format inventory as {item:count, ...} like original Voyager
      const inventoryItems = bot.inventory.items();
      const invMap: Record<string, number> = {};
      for (const item of inventoryItems) {
        invMap[item.name] = (invMap[item.name] || 0) + item.count;
      }
      const inventoryStr = Object.keys(invMap).length > 0
        ? JSON.stringify(invMap)
        : 'empty';

      const inventoryDelta = this.formatInventoryDelta(preState.inventory, postState.inventory);
      const distanceMoved = preState.position.distanceTo(postState.position);

      // Build user message matching the format from the prompt examples
      const lines: string[] = [];
      lines.push(`Biome: ${obs.biome}`);
      lines.push(`Time: ${obs.timeOfDay}`);
      lines.push(`Nearby blocks: ${obs.nearbyBlocks}`);
      lines.push(`Nearby entities: ${obs.nearbyEntities}`);
      lines.push(`Health: ${obs.health}/20`);
      lines.push(`Hunger: ${obs.hunger}/20`);
      lines.push(`Position before: ${preState.position.x.toFixed(0)}, ${preState.position.y.toFixed(0)}, ${preState.position.z.toFixed(0)}`);
      lines.push(`Position after: ${obs.position}`);
      lines.push(`Distance moved: ${distanceMoved.toFixed(1)}`);
      lines.push(`Equipment: ${obs.equipment}`);
      lines.push(`Inventory (${obs.inventorySlots}): ${inventoryStr}`);
      lines.push(`Inventory delta: ${inventoryDelta}`);
      lines.push('');
      lines.push(`Task: ${task.description}`);

      const userMessage = lines.join('\n');

      const response = await this.llmClient!.generate(CRITIC_SYSTEM_PROMPT, userMessage, 1000, { taskType: 'critic' });
      const cleaned = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      logger.info({
        task: task.description,
        llmSuccess: !!parsed.success,
        llmReasoning: parsed.reasoning,
      }, 'Critic LLM result');

      return {
        success: !!parsed.success,
        reason: parsed.reasoning || parsed.reason || 'LLM evaluation',
        critique: parsed.critique || '',
      };
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Critic LLM failed, using default');
      return {
        success: executionResult.success,
        reason: 'LLM critic unavailable, trusting execution result',
        critique: '',
      };
    }
  }

  private shouldPreferSemanticCritic(task: Task): boolean {
    const lower = task.description.toLowerCase();
    if (!lower.includes('craft')) return false;

    // Original Voyager relies on semantic critic evaluation instead of
    // brittle local parsing for multi-step craft tasks with prerequisites
    // or workstation references.
    return [
      ' at ',
      ' using ',
      ' from ',
      ' then ',
      ' next to ',
      'crafting table',
      'furnace',
      'chest',
    ].some((marker) => lower.includes(marker));
  }

  private formatInventoryDelta(before: Record<string, number>, after: Record<string, number>): string {
    const names = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
    const deltas = names
      .map((name) => ({ name, delta: (after[name] || 0) - (before[name] || 0) }))
      .filter((entry) => entry.delta !== 0)
      .map((entry) => `${entry.name}:${entry.delta > 0 ? '+' : ''}${entry.delta}`);
    return deltas.length ? deltas.join(', ') : 'none';
  }
}

export interface BotSnapshot {
  position: { x: number; y: number; z: number; distanceTo: (other: any) => number };
  itemCount: number;
  health: number;
  hunger: number;
  oxygen: number;
  inventory: Record<string, number>;
  nearbyBlocks: string[];
  nearbyEntities: string[];
}

export function takeBotSnapshot(bot: Bot): BotSnapshot {
  const pos = bot.entity.position;
  const inventory = bot.inventory.items().reduce<Record<string, number>>((acc, item) => {
    acc[item.name] = (acc[item.name] || 0) + item.count;
    return acc;
  }, {});
  const nearbyEntities = Object.values(bot.entities)
    .filter((entity) => entity !== bot.entity && entity.position && entity.position.distanceTo(pos) <= 16)
    .map((entity) => entity.type === 'player' ? ((entity as any).username || 'player') : (entity.name || entity.type || 'unknown'));
  const nearbyBlocks = ['farmland', 'water', 'crafting_table', 'furnace', 'oak_log', 'iron_ore', 'coal_ore', 'wheat', 'wheat_seeds']
    .filter((blockName) => bot.findBlock({ matching: (block: any) => block.name === blockName, maxDistance: 16 }));
  return {
    position: {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      distanceTo: (other: any) => Math.sqrt(
        (pos.x - other.x) ** 2 + (pos.y - other.y) ** 2 + (pos.z - other.z) ** 2
      ),
    },
    itemCount: bot.inventory.items().reduce((sum, i) => sum + i.count, 0),
    health: bot.health,
    hunger: bot.food,
    oxygen: (bot.entity as any).oxygenLevel ?? 300,
    inventory,
    nearbyBlocks,
    nearbyEntities,
  };
}
