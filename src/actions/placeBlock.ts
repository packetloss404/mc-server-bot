import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

export async function placeBlock(
  bot: Bot,
  blockType: string,
  x: number,
  y: number,
  z: number
): Promise<ActionResult> {
  const mcData = require('minecraft-data')(bot.version);
  const blockItem = mcData.itemsByName[blockType];
  if (!blockItem) {
    return { success: false, message: `Unknown block type: ${blockType}` };
  }

  // Check inventory for the block
  const item = bot.inventory.findInventoryItem(blockItem.id, null, false);
  if (!item) {
    return { success: false, message: `No ${blockType} in inventory` };
  }

  // Walk near the target location
  bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 3));
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 15000);
    bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
  });

  try {
    await bot.equip(item, 'hand');
    const referenceBlock = bot.blockAt(new Vec3(x, y - 1, z));
    if (!referenceBlock) {
      return { success: false, message: 'No reference block to place against' };
    }
    await bot.placeBlock(referenceBlock, new Vec3(0, 1, 0));
    return { success: true, message: `Placed ${blockType} at ${x}, ${y}, ${z}` };
  } catch (err: any) {
    return { success: false, message: `Place failed: ${err.message}` };
  }
}
