import { Bot } from 'mineflayer';
import { ActionResult } from './types';
import { moveNearWithCleanup } from './moveHelper';

export async function giveItem(bot: Bot, playerName: string, itemName: string, count = 1, onGift?: (playerName: string) => void): Promise<ActionResult> {
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
    const pos = player.entity.position;
    await moveNearWithCleanup(bot, { x: pos.x, y: pos.y, z: pos.z, range: 2 }, 10000);
  }

  try {
    await bot.toss(itemInfo.id, null, count);
    if (onGift) onGift(playerName);
    return { success: true, message: `Tossed ${count} ${itemName} toward ${playerName}` };
  } catch (err: any) {
    return { success: false, message: `Give failed: ${err.message}` };
  }
}
