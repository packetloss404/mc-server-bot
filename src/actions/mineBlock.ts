import { Bot } from 'mineflayer';
import { ActionResult } from './types';
import { moveNearWithCleanup } from './moveHelper';
import { isProtected, getMineSite, shouldRouteToMine } from './geofence';

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

  // Communal-mine routing: raw resources must be gathered AT the designated mine
  // site, never dug out of town. If this is a routed block type and the bot isn't
  // already at the mine, walk there first so the findBlocks search below scans
  // mine terrain rather than whatever the bot is standing in (a road, a house...).
  const mineSite = getMineSite();
  if (mineSite && shouldRouteToMine(blockType)) {
    const radius = mineSite.radius ?? 24;
    const dx = bot.entity.position.x - mineSite.x;
    const dz = bot.entity.position.z - mineSite.z;
    if (dx * dx + dz * dz > radius * radius) {
      const reached = await moveNearWithCleanup(
        bot,
        { x: mineSite.x, y: mineSite.y, z: mineSite.z, range: Math.min(radius, 6) },
        60000,
      );
      if (!reached) {
        return {
          success: false,
          message: `Could not reach the communal mine at ${mineSite.x},${mineSite.y},${mineSite.z} to gather ${blockType}`,
          data: { mined: 0 },
        };
      }
    }
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

  // Geofence: never dig a block inside a protected build zone (roads, houses, the
  // town hall, plazas). This is what stops bots tunnelling through structures —
  // even when a matching block inside a build happens to be the closest one.
  const fencedPositions = safePositions.filter(
    (pos: any) => !isProtected(Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z)),
  );

  if (fencedPositions.length === 0) {
    return {
      success: false,
      message: `All nearby ${blockType} is inside a protected build zone — refusing to dig into town structures. Travel to the communal mine to gather ${blockType}.`,
      data: { mined: 0 },
    };
  }

  const targets = fencedPositions
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
