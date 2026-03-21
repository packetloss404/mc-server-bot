import { Bot } from 'mineflayer';
import { ActionResult } from './types';

export async function craft(bot: Bot, itemName: string, count = 1): Promise<ActionResult> {
  const mcData = require('minecraft-data')(bot.version);
  const item = mcData.itemsByName[itemName];
  if (!item) {
    return { success: false, message: `Unknown item: ${itemName}` };
  }

  const recipes = bot.recipesFor(item.id, null, 1, null);
  if (recipes.length === 0) {
    return { success: false, message: `No recipe found for ${itemName}` };
  }

  try {
    await bot.craft(recipes[0], count, undefined);
    return { success: true, message: `Crafted ${count} ${itemName}` };
  } catch (err: any) {
    return { success: false, message: `Craft failed: ${err.message}` };
  }
}
