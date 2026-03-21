import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { placeBlock } from './placeBlock';
import { ActionResult } from './types';

function inventorySummary(bot: Bot): string {
  return bot.inventory.items().map((item) => `${item.name}x${item.count}`).join(', ') || 'empty';
}

async function moveNear(bot: Bot, x: number, y: number, z: number, range = 3, timeoutMs = 15000): Promise<boolean> {
  bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, range));
  return new Promise<boolean>((resolve) => {
    const onReached = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    const timeout = setTimeout(() => {
      bot.removeListener('goal_reached', onReached as any);
      bot.pathfinder.stop();
      resolve(false);
    }, timeoutMs);
    bot.once('goal_reached' as any, onReached);
  });
}

function findNearbyTable(bot: Bot): any | null {
  const mcData = require('minecraft-data')(bot.version);
  const tableBlock = mcData.blocksByName.crafting_table;
  if (!tableBlock) return null;
  return bot.findBlock({ matching: tableBlock.id, maxDistance: 32 });
}

function candidatePlacementPositions(bot: Bot): Vec3[] {
  const base = bot.entity.position.floored();
  return [
    base.offset(1, 0, 0),
    base.offset(-1, 0, 0),
    base.offset(0, 0, 1),
    base.offset(0, 0, -1),
    base.offset(1, 0, 1),
    base.offset(-1, 0, -1),
  ];
}

async function ensureCraftingTable(bot: Bot): Promise<{ table: any | null; placed: boolean; message: string }> {
  let table = findNearbyTable(bot);
  if (table) {
    return { table, placed: false, message: `Found nearby crafting table at ${table.position}` };
  }

  const mcData = require('minecraft-data')(bot.version);
  const tableItem = mcData.itemsByName.crafting_table;
  if (!tableItem) {
    return { table: null, placed: false, message: 'crafting_table item metadata missing' };
  }

  const hasTable = !!bot.inventory.findInventoryItem(tableItem.id, null, false);
  if (!hasTable) {
    const handRecipe = bot.recipesFor(tableItem.id, null, 1, null)[0];
    if (!handRecipe) {
      return { table: null, placed: false, message: `Need a crafting table but cannot craft one from inventory: ${inventorySummary(bot)}` };
    }
    await bot.craft(handRecipe, 1, undefined);
  }

  let lastMessage = 'Unable to place crafting table';
  for (const pos of candidatePlacementPositions(bot)) {
    const air = bot.blockAt(pos);
    const support = bot.blockAt(pos.offset(0, -1, 0));
    if (air?.name !== 'air' || !support || support.name === 'air') continue;

    const placed = await placeBlock(bot, 'crafting_table', pos.x, pos.y, pos.z);
    lastMessage = placed.message || lastMessage;
    if (!placed.success) continue;

    table = findNearbyTable(bot);
    if (table) {
      return { table, placed: true, message: `Placed crafting table at ${table.position}` };
    }
  }

  return { table: null, placed: false, message: lastMessage };
}

export async function craft(bot: Bot, itemName: string, count = 1): Promise<ActionResult> {
  const mcData = require('minecraft-data')(bot.version);
  const item = mcData.itemsByName[itemName];
  if (!item) {
    return { success: false, message: `Unknown item: ${itemName}` };
  }

  try {
    const handRecipe = bot.recipesFor(item.id, null, 1, null)[0];
    if (handRecipe) {
      await bot.craft(handRecipe, count, undefined);
      return {
        success: true,
        message: `Crafted ${count} ${itemName} by hand. Inventory: ${inventorySummary(bot)}`,
      };
    }

    const tableState = await ensureCraftingTable(bot);
    if (!tableState.table) {
      return { success: false, message: `No recipe found for ${itemName}. ${tableState.message}` };
    }

    const moved = await moveNear(
      bot,
      tableState.table.position.x,
      tableState.table.position.y,
      tableState.table.position.z,
      3,
    );
    if (!moved) {
      return { success: false, message: `Found crafting table for ${itemName} but could not reach it` };
    }

    const tableRecipe = bot.recipesFor(item.id, null, 1, tableState.table)[0];
    if (!tableRecipe) {
      return {
        success: false,
        message: `No recipe found for ${itemName} at crafting table. Inventory: ${inventorySummary(bot)}`,
      };
    }

    await bot.craft(tableRecipe, count, tableState.table);
    return {
      success: true,
      message: `Crafted ${count} ${itemName}${tableState.placed ? ' after placing a crafting table' : ''}. Inventory: ${inventorySummary(bot)}`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Craft failed for ${itemName}: ${err.message}. Inventory: ${inventorySummary(bot)}`,
    };
  }
}
