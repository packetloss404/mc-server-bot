import { ExecutionResult } from './CodeExecutor';
import { Task } from './CurriculumAgent';
import { TaskGuidance, buildTaskGuidance } from './TaskGuidance';
import { BotSnapshot, CriticResult } from './CriticAgent';
import { inferTaskSpec } from './TaskSpec';

export interface TaskGoal {
  count: number;
  item?: string;
  targetEntity?: string;
  targetBlock?: string;
}

interface SuccessCheckContext {
  task: Task;
  guidance: TaskGuidance;
  goal: TaskGoal;
  executionResult: ExecutionResult;
  preState: BotSnapshot;
  postState: BotSnapshot;
}

type SuccessCheck = (context: SuccessCheckContext) => CriticResult | null;

const checkHarvest: SuccessCheck = ({ goal, task, preState, postState }) => {
  const targetDelta = goal.item ? (postState.inventory[goal.item] || 0) - (preState.inventory[goal.item] || 0) : 0;
  if (goal.item && targetDelta >= goal.count) {
    return { success: true, reason: `Collected ${targetDelta} ${goal.item}`, critique: '' };
  }
  // Only count as success if items were GAINED (not just dropped)
  const itemsGained = postState.itemCount > preState.itemCount;
  if (itemsGained) {
    return { success: true, reason: 'Inventory gained items after harvest action', critique: '' };
  }
  return {
    success: false,
    reason: 'Inventory did not gain the expected items',
    critique: `The bot did not collect the expected item${goal.item ? ` (${goal.item})` : ''}. Use mineBlock(...) and verify the exact target block/item name.`,
  };
};

const checkCraft: SuccessCheck = ({ goal, task, preState, postState, guidance }) => {
  const targetDelta = goal.item ? (postState.inventory[goal.item] || 0) - (preState.inventory[goal.item] || 0) : 0;
  if (goal.item && targetDelta >= goal.count) {
    return { success: true, reason: `Crafted ${goal.count} ${goal.item}`, critique: '' };
  }
  // For craft tasks, only succeed if the target item actually appeared in inventory
  // Don't count inventory changes from dropping/tossing items as success
  if (goal.item && targetDelta > 0) {
    return { success: true, reason: `Crafted ${targetDelta} ${goal.item} (less than target ${goal.count})`, critique: '' };
  }
  return {
    success: false,
    reason: goal.item ? `${goal.item} was not crafted (delta: ${targetDelta})` : 'Inventory did not change - nothing was crafted',
    critique: `The craft task did not produce the expected result. Follow the task guidance: ${guidance.guidance.join(' ')}`,
  };
};

const checkSmelt: SuccessCheck = ({ goal, preState, postState, guidance }) => {
  const targetDelta = goal.item ? (postState.inventory[goal.item] || 0) - (preState.inventory[goal.item] || 0) : 0;
  if (goal.item && targetDelta >= goal.count) {
    return { success: true, reason: `Smelted ${goal.count} ${goal.item}`, critique: '' };
  }
  return {
    success: false,
    reason: 'Expected smelted output did not appear in inventory',
    critique: `The furnace workflow did not complete. ${guidance.guidance.join(' ')}`,
  };
};

const checkMovement: SuccessCheck = ({ task, preState, postState }) => {
  const distanceMoved = preState.position.distanceTo(postState.position);
  const movedEnough = distanceMoved > 2;
  if (task.keywords.includes('farm') || task.description.toLowerCase().includes('farmland')) {
    const farmlandNearby = postState.nearbyBlocks.includes('farmland');
    if (movedEnough && farmlandNearby) {
      return { success: true, reason: `Reached area near farmland after moving ${distanceMoved.toFixed(1)} blocks`, critique: '' };
    }
  }
  if (distanceMoved > 2) {
    return { success: true, reason: `Bot moved ${distanceMoved.toFixed(1)} blocks`, critique: '' };
  }
  return {
    success: false,
    reason: 'Bot did not move significantly',
    critique: 'The bot did not move enough. Use moveTo(...) for direct targets or exploreUntil(...) when the destination is not visible.',
  };
};

const checkCombat: SuccessCheck = ({ goal, preState, postState }) => {
  const targetGone = goal.targetEntity
    ? preState.nearbyEntities.some((name) => name.toLowerCase().includes(goal.targetEntity!)) &&
      !postState.nearbyEntities.some((name) => name.toLowerCase().includes(goal.targetEntity!))
    : false;
  if (targetGone) {
    return { success: true, reason: `${goal.targetEntity} is no longer nearby`, critique: '' };
  }
  if (postState.health < preState.health || preState.itemCount !== postState.itemCount) {
    return { success: true, reason: 'Combat activity was observed', critique: '' };
  }
  return null;
};

const checkChat: SuccessCheck = ({ executionResult }) => {
  if (executionResult.output.includes('[chat]')) {
    return { success: true, reason: 'Chat message sent', critique: '' };
  }
  return {
    success: false,
    reason: 'No chat message was sent',
    critique: 'The bot did not speak. Use bot.chat() when the task explicitly requires talking.',
  };
};

const checksByCategory: Record<string, SuccessCheck[]> = {
  harvest: [checkHarvest],
  craft: [checkCraft],
  smelt: [checkSmelt],
  movement: [checkMovement],
  combat: [checkCombat],
  general: [],
};

export function runSuccessChecks(task: Task, executionResult: ExecutionResult, preState: BotSnapshot, postState: BotSnapshot): CriticResult | null {
  const guidance = buildTaskGuidance(task);
  const spec = inferTaskSpec(task);
  const context: SuccessCheckContext = {
    task,
    guidance,
    goal: {
      count: spec.count || 1,
      item: spec.target,
      targetEntity: spec.kind === 'combat' ? spec.target : undefined,
      targetBlock: spec.kind === 'movement' || spec.kind === 'harvest' ? spec.target : undefined,
    },
    executionResult,
    preState,
    postState,
  };

  const allChecks = [...(checksByCategory[guidance.category] || []), checkCombat];
  for (const check of allChecks) {
    const result = check(context);
    if (result) return result;
  }
  return null;
}

export function extractTaskGoal(description: string): TaskGoal {
  const lower = description.toLowerCase();
  const countMatch = lower.match(/\b(\d+)\b/);
  const count = countMatch ? Number(countMatch[1]) : 1;
  const normalized = lower.replace(/[^a-z0-9_\s]/g, ' ');
  const words = normalized.split(/\s+/).filter(Boolean);
  const stop = new Set(['mine', 'collect', 'chop', 'gather', 'craft', 'smelt', 'walk', 'go', 'to', 'the', 'nearest', 'find', 'explore', 'and', 'a', 'an', 'by', 'with', 'use', 'attack', 'fight', 'kill', 'report', 'player']);
  const candidates = words.filter((word) => !stop.has(word) && !/^\d+$/.test(word));
  const item = candidates.length > 0 ? candidates.slice(-2).join('_') : undefined;
  const targetEntity = (lower.match(/kill\s+(?:a|an|the)?\s*([a-z_]+)/) || lower.match(/attack\s+(?:a|an|the)?\s*([a-z_]+)/) || lower.match(/fight\s+(?:a|an|the)?\s*([a-z_]+)/))?.[1];
  const targetBlock = (lower.match(/farmland|water|crafting table|furnace|oak log|iron ore|coal ore|wheat seeds|cobblestone/) || [])[0]?.replace(/\s+/g, '_');
  return { count, item, targetEntity, targetBlock };
}
