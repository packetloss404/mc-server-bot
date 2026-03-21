import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

export async function mineBlock(bot: Bot, blockType: string, count = 1): Promise<ActionResult> {
  const mcData = require('minecraft-data')(bot.version);
  const blockInfo = mcData.blocksByName[blockType];
  if (!blockInfo) {
    return { success: false, message: `Unknown block type: ${blockType}` };
  }

  let mined = 0;

  while (mined < count) {
    const block = bot.findBlock({
      matching: blockInfo.id,
      maxDistance: 32,
    });

    if (!block) {
      return {
        success: mined > 0,
        message: mined > 0 ? `Mined ${mined}/${count} ${blockType}` : `No ${blockType} found nearby`,
        data: { mined },
      };
    }

    // Walk to the block
    const goal = new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2);
    bot.pathfinder.setGoal(goal);

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        bot.pathfinder.stop();
        resolve();
      }, 15000);

      bot.once('goal_reached', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // Equip best tool and dig
    try {
      // Equip best tool for the block
      const bestTool = bot.pathfinder.bestHarvestTool(block);
      if (bestTool) await bot.equip(bestTool, 'hand');
      await bot.dig(block);
      mined++;
    } catch (err: any) {
      return {
        success: mined > 0,
        message: `Mining error after ${mined} blocks: ${err.message}`,
        data: { mined },
      };
    }
  }

  return { success: true, message: `Mined ${mined} ${blockType}`, data: { mined } };
}
