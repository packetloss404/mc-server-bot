import { Bot } from 'mineflayer';
import { ActionResult } from './types';

export async function giveItem(bot: Bot, playerName: string, itemName: string, count = 1): Promise<ActionResult> {
  const mcData = require('minecraft-data')(bot.version);
  const itemInfo = mcData.itemsByName[itemName];
  if (!itemInfo) {
    return { success: false, message: `Unknown item: ${itemName}` };
  }

  const item = bot.inventory.findInventoryItem(itemInfo.id, null, false);
  if (!item) {
    return { success: false, message: `No ${itemName} in inventory` };
  }

  const player = bot.players[playerName];
  if (!player?.entity) {
    return { success: false, message: `Player ${playerName} not found` };
  }

  // Walk to the player first
  const dist = bot.entity.position.distanceTo(player.entity.position);
  if (dist > 3) {
    const { goals } = require('mineflayer-pathfinder');
    bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, 2), true);
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 10000);
      bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
    });
  }

  try {
    await bot.toss(itemInfo.id, null, count);
    return { success: true, message: `Tossed ${count} ${itemName} toward ${playerName}` };
  } catch (err: any) {
    return { success: false, message: `Give failed: ${err.message}` };
  }
}
