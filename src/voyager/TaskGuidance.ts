import { Task } from './CurriculumAgent';
import { inferTaskSpec } from './TaskSpec';

export interface TaskGuidance {
  category: string;
  prompt: string;
  guidance: string[];
}

export function buildTaskGuidance(task: Task): TaskGuidance {
  const desc = task.description.toLowerCase();
  const spec = inferTaskSpec(task);
  const target = spec.target || inferTarget(task.description);

  if (spec.kind === 'craft') {
    return {
      category: 'craft',
      prompt: task.description,
      guidance: [
        `Check whether ${target || 'the target item'} is already in inventory.`,
        'Collect the prerequisite materials before crafting.',
        'Use craftItem(...) for hand crafting or crafting-table crafting.',
        'If a crafting table is needed, ensure one is nearby or place one.',
        'Verify the crafted item appears in inventory before finishing.',
      ],
    };
  }

  if (spec.kind === 'harvest') {
    return {
      category: 'harvest',
      prompt: task.description,
      guidance: [
        `Identify the exact target block or item${target ? ` (${target})` : ''}.`,
        'If the target is not nearby, use exploreUntil(...) to search outward.',
        'Use mineBlock(...) instead of raw digging.',
        'Confirm the target item count increased in inventory before finishing.',
      ],
    };
  }

  if (spec.kind === 'smelt') {
    return {
      category: 'smelt',
      prompt: task.description,
      guidance: [
        'Check for the smelt input and fuel in inventory.',
        'Find a nearby furnace and move close enough to use it.',
        'Use smeltItem(...) instead of scripting furnace interaction manually.',
        'Confirm the smelted output item appears in inventory before finishing.',
      ],
    };
  }

  if (spec.kind === 'movement') {
    return {
      category: 'movement',
      prompt: task.description,
      guidance: [
        'Identify the destination or search target first.',
        'Use moveTo(...) for direct destinations.',
        'Use exploreUntil(...) if the destination target is not immediately visible.',
        'Do not stop after locating the target if the task implies reaching it.',
      ],
    };
  }

  if (spec.kind === 'combat') {
    return {
      category: 'combat',
      prompt: task.description,
      guidance: [
        `Identify the combat target${target ? ` (${target})` : ''}.`,
        'Move close enough to engage the target safely.',
        'Use killMob(...) instead of raw attack loops.',
        'Confirm the target is gone or combat clearly occurred before finishing.',
      ],
    };
  }

  return {
    category: 'general',
    prompt: task.description,
    guidance: [
      'Identify the concrete target or outcome.',
      'Use existing primitives whenever possible.',
      'Verify the intended state change before finishing.',
    ],
  };
}

function inferTarget(description: string): string | null {
  const cleaned = description.toLowerCase().replace(/[^a-z0-9_\s]/g, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  const stop = new Set(['mine', 'collect', 'gather', 'chop', 'craft', 'smelt', 'walk', 'go', 'to', 'the', 'nearest', 'find', 'explore', 'attack', 'fight', 'kill', 'report', 'and', 'a', 'an', 'of']);
  const candidates = words.filter((word) => !stop.has(word) && !/^\d+$/.test(word));
  if (candidates.length === 0) return null;
  return candidates.slice(-2).join('_');
}
