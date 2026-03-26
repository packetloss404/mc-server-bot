import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

function inventorySummary(bot: Bot): string {
  return bot.inventory.items().map((item) => `${item.name}x${item.count}`).join(', ') || 'empty';
}

async function moveToCraftingTable(bot: Bot, craftingTable: any): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const GoalLookAtBlock = (goals as any).GoalLookAtBlock;
    const goal = GoalLookAtBlock
      ? new GoalLookAtBlock(craftingTable.position, bot.world)
      : new goals.GoalNear(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 3);

    bot.pathfinder.setGoal(goal);

    const onReached = () => {
      clearTimeout(timeout);
      resolve(true);
    };

    const timeout = setTimeout(() => {
      bot.removeListener('goal_reached', onReached as any);
      bot.pathfinder.stop();
      resolve(false);
    }, 15000);

    bot.once('goal_reached' as any, onReached);
  });
}

export async function craft(bot: Bot, itemName: string, count = 1): Promise<ActionResult> {
  if (typeof itemName !== 'string') {
    return { success: false, message: 'name for craftItem must be a string' };
  }
  if (typeof count !== 'number') {
    return { success: false, message: 'count for craftItem must be a number' };
  }

  const mcData = require('minecraft-data')(bot.version);
  const item = mcData.itemsByName[itemName];
  if (!item) {
    return { success: false, message: `No item named ${itemName}` };
  }

  const craftingTable = bot.findBlock({
    matching: mcData.blocksByName.crafting_table.id,
    maxDistance: 32,
  });

  if (craftingTable) {
    const moved = await moveToCraftingTable(bot, craftingTable);
    if (!moved) {
      return { success: false, message: `Found crafting table for ${itemName} but could not reach it` };
    }
  }

  const recipe = bot.recipesFor(item.id, null, 1, craftingTable || null)[0];
  if (!recipe) {
    return {
      success: false,
      message: `No recipe found for ${itemName}. Inventory: ${inventorySummary(bot)}`,
    };
  }

  try {
    await bot.craft(recipe, count, craftingTable || undefined);
    return {
      success: true,
      message: `Crafted ${count} ${itemName}. Inventory: ${inventorySummary(bot)}`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Craft failed for ${itemName}: ${err.message}. Inventory: ${inventorySummary(bot)}`,
    };
  }
}
