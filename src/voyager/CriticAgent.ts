import { Bot } from 'mineflayer';
import { LLMClient } from '../ai/LLMClient';
import { Task } from './CurriculumAgent';
import { ExecutionResult } from './CodeExecutor';
import { renderObservation, formatObservation } from './Observation';
import { logger } from '../util/logger';

export interface CriticResult {
  success: boolean;
  reason: string;
  critique: string; // feedback for the action agent on retry
}

const CRITIC_SYSTEM_PROMPT = `You are a task completion judge for a Minecraft bot. Given a task and the bot's state before and after execution, determine if the task was completed successfully.

You should check:
- For mining tasks: Did the inventory gain the expected items?
- For crafting tasks: Did the inventory gain the crafted item?
- For movement tasks: Did the bot move to the expected location?
- For combat tasks: Is the target mob gone or did health decrease?
- For building/placing tasks: Were blocks placed?

Output ONLY a JSON object with no markdown fences:
{"reasoning": "brief analysis", "success": true/false, "critique": "if failed, specific advice on what to fix. empty string if success."}`;

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

    // Programmatic checks first (strict)
    const programmatic = this.programmaticCheck(task, executionResult, preState, postState);
    if (programmatic) return programmatic;

    // LLM check with rich observation
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
    const desc = task.description.toLowerCase();
    const distanceMoved = preState.position.distanceTo(postState.position);
    const moved = distanceMoved > 2;
    const itemsChanged = preState.itemCount !== postState.itemCount;

    logger.info({
      task: task.description,
      prePosition: `${preState.position.x.toFixed(1)},${preState.position.y.toFixed(1)},${preState.position.z.toFixed(1)}`,
      postPosition: `${postState.position.x.toFixed(1)},${postState.position.y.toFixed(1)},${postState.position.z.toFixed(1)}`,
      distanceMoved: Number(distanceMoved.toFixed(2)),
      preItemCount: preState.itemCount,
      postItemCount: postState.itemCount,
      itemsChanged,
      preHealth: preState.health,
      postHealth: postState.health,
    }, 'Critic state diff');

    // Mining/collecting tasks — MUST change inventory
    if (desc.includes('mine') || desc.includes('collect') || desc.includes('chop') || desc.includes('gather')) {
      if (itemsChanged) {
        logger.info({ task: task.description, check: 'programmatic-mining', result: 'success' }, 'Critic programmatic decision');
        return { success: true, reason: 'Inventory changed after mining', critique: '' };
      }
      logger.info({ task: task.description, check: 'programmatic-mining', result: 'failure' }, 'Critic programmatic decision');
      return {
        success: false,
        reason: 'Inventory did not change — nothing was mined',
        critique: 'The bot did not collect any items. Make sure to use mineBlock() which handles pathfinding and collecting. Check that the block name is correct (e.g. "oak_log" not "wood").',
      };
    }

    // Crafting tasks — MUST change inventory
    if (desc.includes('craft') || desc.includes('smelt')) {
      if (itemsChanged) {
        logger.info({ task: task.description, check: 'programmatic-crafting', result: 'success' }, 'Critic programmatic decision');
        return { success: true, reason: 'Inventory changed after crafting', critique: '' };
      }
      logger.info({ task: task.description, check: 'programmatic-crafting', result: 'failure' }, 'Critic programmatic decision');
      return {
        success: false,
        reason: 'Inventory did not change — nothing was crafted',
        critique: 'The craft did not produce items. Check that required materials are in inventory and the item name is correct.',
      };
    }

    // Movement tasks
    if (desc.includes('walk') || desc.includes('go to') || desc.includes('explore') || desc.includes('patrol') || desc.includes('move')) {
      if (moved) {
        logger.info({ task: task.description, check: 'programmatic-movement', result: 'success' }, 'Critic programmatic decision');
        return { success: true, reason: 'Bot moved to a new position', critique: '' };
      }
      logger.info({ task: task.description, check: 'programmatic-movement', result: 'failure' }, 'Critic programmatic decision');
      return {
        success: false,
        reason: 'Bot did not move significantly',
        critique: 'The bot did not move. Check that the pathfinding goal is reachable and the coordinates are correct.',
      };
    }

    // Chat tasks
    if (desc.includes('chat') || desc.includes('announce') || desc.includes('say') || desc.includes('talk') || desc.includes('challenge')) {
      if (executionResult.output.includes('[chat]')) {
        logger.info({ task: task.description, check: 'programmatic-chat', result: 'success' }, 'Critic programmatic decision');
        return { success: true, reason: 'Chat message sent', critique: '' };
      }
      logger.info({ task: task.description, check: 'programmatic-chat', result: 'failure' }, 'Critic programmatic decision');
      return {
        success: false,
        reason: 'No chat message was sent',
        critique: 'The bot did not send a chat message. Use bot.chat() to speak.',
      };
    }

    // Combat tasks
    if (desc.includes('kill') || desc.includes('attack') || desc.includes('fight')) {
      if (postState.health < preState.health || itemsChanged) {
        logger.info({ task: task.description, check: 'programmatic-combat', result: 'success' }, 'Critic programmatic decision');
        return { success: true, reason: 'Combat occurred', critique: '' };
      }
      // Don't fail programmatically — LLM check may be needed
    }

    return null; // Can't determine — fall through to LLM
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
      const obsText = formatObservation(obs);

      const userMessage = `Task: ${task.description}

Code output:
${executionResult.output.slice(0, 500)}

Position before: ${preState.position.x.toFixed(0)}, ${preState.position.y.toFixed(0)}, ${preState.position.z.toFixed(0)}
Position after: ${obs.position}
Items before: ${preState.itemCount}
Items after: ${postState.itemCount}

Current state:
${obsText}

Was the task completed successfully?`;

      const response = await this.llmClient!.generate(CRITIC_SYSTEM_PROMPT, userMessage, 200);
      const cleaned = response.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

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
}

export interface BotSnapshot {
  position: { x: number; y: number; z: number; distanceTo: (other: any) => number };
  itemCount: number;
  health: number;
}

export function takeBotSnapshot(bot: Bot): BotSnapshot {
  const pos = bot.entity.position;
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
  };
}
