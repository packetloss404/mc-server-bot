import { Bot } from 'mineflayer';
import { ActionResult } from './types';

const PICKAXE_TIERS = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
const AXE_TIERS = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
const SHOVEL_TIERS = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];

function pickBestTool(bot: Bot, suffix: string, tiers: string[]): any | null {
  const items = bot.inventory.items();
  for (const tier of tiers) {
    const hit = items.find((i) => i.name === `${tier}_${suffix}`);
    if (hit) return hit;
  }
  return null;
}

/**
 * Choose the best tool for the target block. Returns the inventory item to
 * equip, or null if no specialized tool helps (in which case bare hands work).
 */
function selectToolFor(bot: Bot, blockName: string): any | null {
  if (blockName.endsWith('_log') || blockName.endsWith('_wood') || blockName.endsWith('_planks')) {
    return pickBestTool(bot, 'axe', AXE_TIERS);
  }
  if (blockName === 'dirt' || blockName === 'grass_block' || blockName === 'sand' || blockName === 'gravel' || blockName === 'clay') {
    return pickBestTool(bot, 'shovel', SHOVEL_TIERS);
  }
  // Everything stone-like uses a pickaxe.
  return pickBestTool(bot, 'pickaxe', PICKAXE_TIERS);
}

export async function mineBlock(bot: Bot, blockType: string, count = 1): Promise<ActionResult> {
  if (typeof blockType !== 'string') {
    return { success: false, message: 'mineBlock requires blockType to be a string' };
  }
  if (typeof count !== 'number') {
    return { success: false, message: 'mineBlock requires count to be a number' };
  }

  const mcData = require('minecraft-data')(bot.version);
  const blockInfo = mcData.blocksByName[blockType];
  if (!blockInfo) {
    return { success: false, message: `Unknown block type: ${blockType}` };
  }

  const positions = bot.findBlocks({
    matching: [blockInfo.id],
    maxDistance: 32,
    count: Math.max(count * 4, 16), // overscan so we still have candidates after the safety filter
  });

  if (positions.length === 0) {
    return {
      success: false,
      message: `No ${blockType} nearby, please explore first`,
      data: { mined: 0 },
    };
  }

  // Vertical safety filter: never mine the block directly supporting the bot's feet.
  // Otherwise the bot can dig itself into a 1-block hole and free-fall into whatever
  // is below. Allow blocks further down (deliberate downward mining is fine, just not
  // the single block under our boots).
  const botPos = bot.entity.position;
  const supportY = Math.floor(botPos.y) - 1;
  const supportX = Math.floor(botPos.x);
  const supportZ = Math.floor(botPos.z);
  const safePositions = positions.filter((pos: any) => {
    return !(
      Math.floor(pos.y) === supportY &&
      Math.floor(pos.x) === supportX &&
      Math.floor(pos.z) === supportZ
    );
  });

  if (safePositions.length === 0) {
    return {
      success: false,
      message: `${blockType} only exists directly under the bot — refusing to dig the support block (would drop the bot)`,
      data: { mined: 0 },
    };
  }

  const targets = safePositions
    .slice(0, count)
    .map((pos: any) => bot.blockAt(pos))
    .filter((block: any) => block);

  if (targets.length === 0) {
    return {
      success: false,
      message: `Found ${blockType} positions but could not resolve blocks`,
      data: { mined: 0 },
    };
  }

  // Equip the best available tool for this block type. Bare-handed mining is
  // slow and silently fails on most blocks (no drop), so always try to upgrade.
  const tool = selectToolFor(bot, blockType);
  if (tool) {
    try {
      await bot.equip(tool, 'hand');
    } catch {
      // Non-fatal: equip can race with other actions. Continue with whatever's held.
    }
  }

  try {
    await (bot as any).collectBlock.collect(targets, {
      ignoreNoPath: true,
    });
    return {
      success: true,
      message: `Mined up to ${count} ${blockType}`,
      data: { mined: count },
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Mining error for ${blockType}: ${err.message}`,
      data: { mined: 0 },
    };
  }
}
