/**
 * ErrorRecovery — analyzes task failures and provides specific, actionable
 * recovery hints for the ActionAgent's retry loop.
 *
 * Instead of generic critique, this module recognizes common failure patterns
 * and injects concrete instructions (e.g. "gather materials first", "use a
 * different tool", "the target doesn't exist at that location").
 */

import { Bot } from 'mineflayer';
import { logger } from '../util/logger';

export interface RecoveryHint {
  /** Short label for the failure pattern */
  pattern: string;
  /** Concrete instruction to prepend to the retry prompt */
  hint: string;
  /** If true, the task itself should be replaced (e.g. gather materials first) */
  replaceTask?: string;
  /** If true, skip further retries — this task is impossible right now */
  abandon?: boolean;
}

interface FailureContext {
  task: string;
  error: string;
  critique: string;
  code: string;
  bot: Bot;
  attempt: number;
  maxAttempts: number;
}

/**
 * Analyze a failure and return a recovery hint with specific instructions.
 * Returns null if no known pattern matches (falls back to generic retry).
 */
export function analyzeFailure(ctx: FailureContext): RecoveryHint | null {
  const { task, error, critique, code, bot } = ctx;
  const lowerError = (error || '').toLowerCase();
  const lowerCritique = (critique || '').toLowerCase();
  const lowerTask = task.toLowerCase();
  const combined = `${lowerError} ${lowerCritique}`;

  // ── Crafting failures ─────────────────────────────────
  if (combined.includes('was not crafted') || combined.includes('not crafted')) {
    const itemMatch = error.match(/(\w+) was not crafted/i);
    const targetItem = itemMatch?.[1] || 'the item';

    // Check what materials the bot actually has
    const inv = Object.fromEntries(
      bot.inventory.items().map((i) => [i.name, i.count])
    );
    const invSummary = Object.entries(inv).map(([k, v]) => `${k}:${v}`).join(', ') || 'empty';

    // Common crafting prerequisites
    const craftHints = getCraftingHint(targetItem, inv);
    if (craftHints) {
      const firstMissing = getFirstMissingMaterial(targetItem, inv);
      return {
        pattern: 'missing_craft_materials',
        hint: `CRAFTING FAILED for "${targetItem}". Your current inventory: [${invSummary}]. ${craftHints} Gather the missing materials FIRST using mineBlock(), then craft.`,
        replaceTask: firstMissing ? `Obtain ${firstMissing}` : undefined,
      };
    }

    // Check if crafting table is needed and nearby
    const hasCraftingTable = !!bot.findBlock({
      matching: (b: any) => b.name === 'crafting_table',
      maxDistance: 32,
    });
    const needsTable = !['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'stick', 'sticks'].includes(targetItem);

    if (needsTable && !hasCraftingTable && !inv['crafting_table']) {
      return {
        pattern: 'no_crafting_table',
        hint: `CRAFTING FAILED: No crafting table nearby and none in inventory. First craft a crafting_table (needs 4 planks), place it, then craft ${targetItem}. Inventory: [${invSummary}]`,
      };
    }

    return {
      pattern: 'craft_failed_generic',
      hint: `CRAFTING FAILED for "${targetItem}". Inventory: [${invSummary}]. Make sure you have all required materials. Use craftItem("${targetItem}", 1). If it needs a crafting table, find or place one first.`,
    };
  }

  // ── Mining failures ───────────────────────────────────
  if (combined.includes('inventory did not gain') || combined.includes('did not collect')) {
    // Check if bot has appropriate tool
    const toolCheck = checkMiningTool(lowerTask, bot);
    if (toolCheck) return toolCheck;

    // Check if target block exists nearby
    const targetBlock = extractBlockName(lowerTask);
    if (targetBlock) {
      const found = bot.findBlock({
        matching: (b: any) => b.name === targetBlock,
        maxDistance: 32,
      });
      if (!found) {
        return {
          pattern: 'target_not_found',
          hint: `MINING FAILED: No "${targetBlock}" found within 32 blocks. Use exploreUntil() to search for it first, THEN mine it. Do not assume it is nearby.`,
        };
      }
    }

    return {
      pattern: 'mine_failed_generic',
      hint: `MINING FAILED: The block was not collected. Possible causes: wrong block name, no suitable tool, or block is too far away. Use bot.findBlock() to verify the target exists, then mineBlock(name, count).`,
    };
  }

  // ── API misuse errors ─────────────────────────────────
  if (lowerError.includes('is not a function') || lowerError.includes('is not defined')) {
    const fnMatch = error.match(/(\w+(?:\.\w+)*) is not (?:a function|defined)/i);
    const badCall = fnMatch?.[1] || 'unknown';

    const fixes: Record<string, string> = {
      'require': 'require() is not available in the sandbox. Do not import modules. Use the built-in primitives (mineBlock, craftItem, moveTo, etc.) and bot APIs.',
      'pos.floored': 'pos.floored does not exist. Use new Vec3(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)) or just use pos directly.',
      'bot.inventory.findInventoryItem': 'Use bot.inventory.items().find(i => i.name === "itemName") instead.',
      'bot.inventory.findItem': 'Use bot.inventory.items().find(i => i.name === "itemName") instead.',
      'bot.creative': 'This is a survival server. bot.creative does not exist.',
      'mcData': 'minecraft-data is not available. Use bot.findBlock() and bot.inventory.items() instead.',
    };

    for (const [pattern, fix] of Object.entries(fixes)) {
      if (badCall.includes(pattern) || lowerError.includes(pattern.toLowerCase())) {
        return { pattern: 'bad_api_call', hint: `API ERROR: ${fix}` };
      }
    }

    return {
      pattern: 'bad_api_call',
      hint: `API ERROR: "${badCall}" does not exist. Only use the primitives listed in the system prompt (mineBlock, craftItem, moveTo, etc.) and standard bot.* APIs.`,
    };
  }

  // ── Null reference errors ─────────────────────────────
  if (lowerError.includes('cannot read properties of null') || lowerError.includes('cannot read properties of undefined')) {
    const propMatch = error.match(/reading '(\w+)'/i);
    const prop = propMatch?.[1] || 'unknown';

    if (prop === 'position' || prop === 'x' || prop === 'y' || prop === 'z') {
      return {
        pattern: 'null_position',
        hint: `NULL ERROR: A block or entity lookup returned null (not found). Always check the result of bot.findBlock() and bot.nearestEntity() before accessing .position. Example: const block = bot.findBlock(...); if (!block) { /* handle not found */ }`,
      };
    }

    return {
      pattern: 'null_reference',
      hint: `NULL ERROR: Tried to read "${prop}" from null/undefined. Add null checks before accessing properties. For bot.findBlock(), the block may not exist nearby.`,
    };
  }

  // ── Timeout errors ────────────────────────────────────
  if (lowerError.includes('timed out') || lowerError.includes('timeout')) {
    return {
      pattern: 'timeout',
      hint: 'TIMEOUT: The code took too long. Simplify the approach: do ONE thing (mine, move, or craft), not a long chain. If pathfinding times out, the destination may be unreachable — try a closer target.',
    };
  }

  // ── Swimming false positives ──────────────────────────
  if (lowerTask.includes('swim') && lowerTask.includes('surface')) {
    const pos = bot.entity?.position;
    const isUnderwater = pos && bot.findBlock({
      matching: (b: any) => b.name === 'water',
      maxDistance: 2,
    });

    if (!isUnderwater && pos && pos.y >= 62) {
      return {
        pattern: 'already_safe',
        hint: 'The bot is already at or above water level and not drowning. No swimming needed.',
        abandon: true,
      };
    }
  }

  // ── No movement errors ────────────────────────────────
  if (combined.includes('position did not change') || combined.includes('distance moved: 0')) {
    if (lowerTask.includes('swim') || lowerTask.includes('surface')) {
      return {
        pattern: 'no_movement_swim',
        hint: 'SWIMMING FAILED: bot did not move. Use bot.setControlState("jump", true) and bot.setControlState("forward", true), wait with await bot.waitForTicks(40), then bot.clearControlStates(). Do NOT use moveTo() underwater — pathfinder cannot swim.',
      };
    }

    return {
      pattern: 'no_movement',
      hint: 'The bot did not move. If using moveTo(), verify the coordinates are reachable. If the bot is stuck, try moveTo() to a slightly different nearby position first.',
    };
  }

  return null;
}

/** Get specific crafting hints based on what materials are needed vs what bot has */
function getCraftingHint(item: string, inv: Record<string, number>): string | null {
  const recipes: Record<string, Record<string, number>> = {
    'stick': { 'oak_planks': 2 },
    'sticks': { 'oak_planks': 2 },
    'crafting_table': { 'oak_planks': 4 },
    'wooden_pickaxe': { 'oak_planks': 3, 'stick': 2 },
    'wooden_axe': { 'oak_planks': 3, 'stick': 2 },
    'wooden_shovel': { 'oak_planks': 1, 'stick': 2 },
    'wooden_hoe': { 'oak_planks': 2, 'stick': 2 },
    'wooden_sword': { 'oak_planks': 2, 'stick': 1 },
    'stone_pickaxe': { 'cobblestone': 3, 'stick': 2 },
    'stone_axe': { 'cobblestone': 3, 'stick': 2 },
    'stone_shovel': { 'cobblestone': 1, 'stick': 2 },
    'stone_hoe': { 'cobblestone': 2, 'stick': 2 },
    'stone_sword': { 'cobblestone': 2, 'stick': 1 },
    'iron_pickaxe': { 'iron_ingot': 3, 'stick': 2 },
    'iron_sword': { 'iron_ingot': 2, 'stick': 1 },
    'iron_axe': { 'iron_ingot': 3, 'stick': 2 },
    'iron_shovel': { 'iron_ingot': 1, 'stick': 2 },
    'iron_hoe': { 'iron_ingot': 2, 'stick': 2 },
    'furnace': { 'cobblestone': 8 },
    'chest': { 'oak_planks': 8 },
    'oak_planks': { 'oak_log': 1 },
    'spruce_planks': { 'spruce_log': 1 },
    'birch_planks': { 'birch_log': 1 },
    'torch': { 'stick': 1, 'coal': 1 },
    'bread': { 'wheat': 3 },
    'bucket': { 'iron_ingot': 3 },
  };

  const recipe = recipes[item.toLowerCase()];
  if (!recipe) return null;

  // Handle planks substitution (any log type works)
  const planksCount = (inv['oak_planks'] || 0) + (inv['spruce_planks'] || 0) +
    (inv['birch_planks'] || 0) + (inv['jungle_planks'] || 0) +
    (inv['acacia_planks'] || 0) + (inv['dark_oak_planks'] || 0);

  const missing: string[] = [];
  for (const [mat, needed] of Object.entries(recipe)) {
    let have = inv[mat] || 0;
    if (mat === 'oak_planks') have = Math.max(have, planksCount);
    if (have < needed) {
      missing.push(`${mat} (need ${needed}, have ${have})`);
    }
  }

  if (missing.length === 0) {
    return `You HAVE all materials for ${item}. Make sure to use craftItem("${item}", 1) — not craft the ingredients again.`;
  }

  return `Missing materials for ${item}: ${missing.join(', ')}. Gather these FIRST.`;
}

/** Check if bot has the right mining tool for the task */
function checkMiningTool(task: string, bot: Bot): RecoveryHint | null {
  const toolRequirements: Record<string, string[]> = {
    'iron_ore': ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'],
    'gold_ore': ['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'],
    'diamond_ore': ['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'],
    'redstone_ore': ['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'],
    'lapis_ore': ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'],
    'emerald_ore': ['iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'],
    'cobblestone': ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'],
    'stone': ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'],
    'coal_ore': ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'],
    'copper_ore': ['stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'],
  };

  const invItems = new Set(bot.inventory.items().map((i) => i.name));

  for (const [ore, tools] of Object.entries(toolRequirements)) {
    if (task.includes(ore)) {
      const hasTool = tools.some((t) => invItems.has(t));
      if (!hasTool) {
        const minTool = tools[0];
        return {
          pattern: 'wrong_tool',
          hint: `MINING FAILED: You need at least a ${minTool} to mine ${ore}. Craft one first. Your inventory has: ${[...invItems].filter(i => i.includes('pickaxe')).join(', ') || 'no pickaxe'}.`,
          replaceTask: `Craft a ${minTool}`,
        };
      }
    }
  }

  return null;
}

/** Return the first missing material for a crafting recipe, or null */
function getFirstMissingMaterial(item: string, inv: Record<string, number>): string | null {
  const recipes: Record<string, Record<string, number>> = {
    'stick': { 'oak_planks': 2 },
    'sticks': { 'oak_planks': 2 },
    'crafting_table': { 'oak_planks': 4 },
    'wooden_pickaxe': { 'oak_planks': 3, 'stick': 2 },
    'wooden_axe': { 'oak_planks': 3, 'stick': 2 },
    'wooden_shovel': { 'oak_planks': 1, 'stick': 2 },
    'wooden_hoe': { 'oak_planks': 2, 'stick': 2 },
    'wooden_sword': { 'oak_planks': 2, 'stick': 1 },
    'stone_pickaxe': { 'cobblestone': 3, 'stick': 2 },
    'stone_axe': { 'cobblestone': 3, 'stick': 2 },
    'stone_shovel': { 'cobblestone': 1, 'stick': 2 },
    'stone_hoe': { 'cobblestone': 2, 'stick': 2 },
    'stone_sword': { 'cobblestone': 2, 'stick': 1 },
    'iron_pickaxe': { 'iron_ingot': 3, 'stick': 2 },
    'iron_sword': { 'iron_ingot': 2, 'stick': 1 },
    'iron_axe': { 'iron_ingot': 3, 'stick': 2 },
    'iron_shovel': { 'iron_ingot': 1, 'stick': 2 },
    'iron_hoe': { 'iron_ingot': 2, 'stick': 2 },
    'furnace': { 'cobblestone': 8 },
    'chest': { 'oak_planks': 8 },
    'oak_planks': { 'oak_log': 1 },
    'spruce_planks': { 'spruce_log': 1 },
    'birch_planks': { 'birch_log': 1 },
    'torch': { 'stick': 1, 'coal': 1 },
    'bread': { 'wheat': 3 },
    'bucket': { 'iron_ingot': 3 },
  };

  const recipe = recipes[item.toLowerCase()];
  if (!recipe) return null;

  const planksCount = (inv['oak_planks'] || 0) + (inv['spruce_planks'] || 0) +
    (inv['birch_planks'] || 0) + (inv['jungle_planks'] || 0) +
    (inv['acacia_planks'] || 0) + (inv['dark_oak_planks'] || 0);

  for (const [mat, needed] of Object.entries(recipe)) {
    let have = inv[mat] || 0;
    if (mat === 'oak_planks') have = Math.max(have, planksCount);
    if (have < needed) return mat;
  }
  return null;
}

/** Extract block name from a task description */
function extractBlockName(task: string): string | null {
  const match = task.match(/mine\s+(?:\d+\s+)?(\w+(?:_\w+)*)/i);
  return match?.[1] || null;
}
