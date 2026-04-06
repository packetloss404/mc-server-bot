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

  // Survival tasks (swim, eat, flee, shelter)
  if (/shore|land.*water|walk.*shore/i.test(desc)) {
    return {
      category: 'survival',
      prompt: task.description,
      guidance: [
        'The bot is in water and needs to reach land.',
        'Use bot.findBlock({matching: b => b.name === "grass_block" || b.name === "dirt" || b.name === "sand" || b.name === "stone", maxDistance: 32}) to find land.',
        'If land is found, use moveTo(land.position.x, land.position.y, land.position.z, 2, 30) to walk there.',
        'If no land is found within 32 blocks, use bot.setControlState("forward", true) and swim in a direction for 3 seconds, then search again.',
        'Do NOT keep swimming to the surface — the bot is AT the surface. It needs to reach SHORE.',
      ],
    };
  }

  if (/swim|drown|surface|underwater/i.test(desc)) {
    return {
      category: 'survival',
      prompt: task.description,
      guidance: [
        'Use bot.setControlState("jump", true) and bot.setControlState("forward", true) to swim upward.',
        'Wait with await bot.waitForTicks(40-60) while swimming.',
        'Then call bot.clearControlStates() to stop.',
        'Check bot.entity.position.y — if still underwater, repeat.',
        'Once at surface, use moveTo to reach land.',
        'Do NOT use moveTo or pathfinder while underwater — it cannot swim.',
      ],
    };
  }

  if (/eat|hungry|starv|food/i.test(desc)) {
    return {
      category: 'survival',
      prompt: task.description,
      guidance: [
        'Find food in inventory: bot.inventory.items().find(i => i.foodRecovery > 0)',
        'Equip food to hand: await bot.equip(food, "hand")',
        'Eat: await bot.consume()',
        'If no food in inventory, try to find and kill a nearby animal (cow, pig, chicken, sheep) using killMob.',
        'Then pick up the dropped meat.',
      ],
    };
  }

  if (/flee|run away|escape|danger/i.test(desc)) {
    return {
      category: 'survival',
      prompt: task.description,
      guidance: [
        'Find the threat: bot.nearestEntity(e => e.type === "hostile")',
        'Calculate flee direction: opposite of threat direction.',
        'Use moveTo to run away at least 20 blocks.',
        'Use bot.setControlState("sprint", true) for speed.',
        'After reaching safety, call bot.clearControlStates().',
      ],
    };
  }

  if (/shelter|house|hide|night|sleep/i.test(desc)) {
    return {
      category: 'survival',
      prompt: task.description,
      guidance: [
        'Gather 10-20 blocks of dirt or cobblestone if not in inventory.',
        'Build a small 3x3x3 enclosure with placeItem.',
        'Leave one block open as a door or place a door.',
        'Stay inside until dawn (bot.time.timeOfDay < 13000 means daytime).',
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
