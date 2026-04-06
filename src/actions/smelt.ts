import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

function inventorySummary(bot: Bot): string {
  return bot.inventory.items().map((item) => `${item.name}x${item.count}`).join(', ') || 'empty';
}

async function moveNear(bot: Bot, x: number, y: number, z: number, range = 3, timeoutMs = 15000): Promise<boolean> {
  bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, range));
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      bot.removeListener('goal_reached', onReached as any);
      bot.removeListener('path_update' as any, onPathUpdate);
      if (!result) bot.pathfinder.stop();
      resolve(result);
    };
    const onReached = () => done(true);
    const onPathUpdate = (r: any) => {
      if (r?.status === 'noPath') done(false);
    };
    const timeout = setTimeout(() => done(false), timeoutMs);
    bot.once('goal_reached' as any, onReached);
    bot.on('path_update' as any, onPathUpdate);
  });
}

const FURNACE_OPEN_TIMEOUT = 10000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

export async function smelt(bot: Bot, itemName: string, fuelName: string, count = 1): Promise<ActionResult> {
  const mcData = require('minecraft-data')(bot.version);
  const item = mcData.itemsByName[itemName];
  const fuel = mcData.itemsByName[fuelName];
  const furnaceBlockInfo = mcData.blocksByName.furnace;

  if (!item) return { success: false, message: `Unknown smelt input: ${itemName}` };
  if (!fuel) return { success: false, message: `Unknown smelt fuel: ${fuelName}` };
  if (!furnaceBlockInfo) return { success: false, message: 'Furnace block metadata missing' };

  const furnaceBlock = bot.findBlock({ matching: furnaceBlockInfo.id, maxDistance: 32 });
  if (!furnaceBlock) {
    return { success: false, message: `No furnace nearby for smelting ${itemName}` };
  }

  const moved = await moveNear(bot, furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 3);
  if (!moved) {
    return { success: false, message: `Found furnace for ${itemName} but could not reach it` };
  }

  try {
    const furnace: any = await withTimeout((bot as any).openFurnace(furnaceBlock), FURNACE_OPEN_TIMEOUT, 'openFurnace');
    let smelted = 0;

    for (let i = 0; i < count; i++) {
      if (!bot.inventory.findInventoryItem(item.id, null, false)) break;
      if (!bot.inventory.findInventoryItem(fuel.id, null, false) && !(furnace as any).fuelItem()) break;

      if (((furnace as any).fuelSeconds || 0) < 15 && !(furnace as any).fuelItem()) {
        await furnace.putFuel(fuel.id, null, 1);
        await bot.waitForTicks(20);
      }

      await furnace.putInput(item.id, null, 1);
      await bot.waitForTicks(12 * 20);
      if (!(furnace as any).outputItem()) break;
      await furnace.takeOutput();
      smelted++;
    }

    furnace.close();

    if (smelted === 0) {
      return {
        success: false,
        message: `Failed to smelt ${itemName}. Check fuel/input. Inventory: ${inventorySummary(bot)}`,
      };
    }

    return {
      success: true,
      message: `Smelted ${smelted} ${itemName}. Inventory: ${inventorySummary(bot)}`,
      data: { smelted },
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Smelting ${itemName} failed: ${err.message}. Inventory: ${inventorySummary(bot)}`,
    };
  }
}
