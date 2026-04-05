import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

/**
 * Item name substrings that mark an item as "essential" and should NOT be deposited.
 * Covers tools, weapons, armor, and food items.
 */
const ESSENTIAL_PATTERNS: readonly string[] = [
  // Tools
  '_pickaxe', '_axe', '_shovel', '_hoe',
  // Weapons
  '_sword', 'bow', 'crossbow', 'trident', 'shield',
  // Armor
  '_helmet', '_chestplate', '_leggings', '_boots',
  // Food
  'bread', 'cooked_', 'baked_potato', 'golden_apple', 'apple', 'steak',
  'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton',
  'cooked_rabbit', 'cooked_salmon', 'cooked_cod', 'golden_carrot',
  'mushroom_stew', 'rabbit_stew', 'beetroot_soup', 'pumpkin_pie',
  'cake', 'cookie', 'melon_slice', 'sweet_berries', 'dried_kelp',
];

function isEssentialItem(itemName: string): boolean {
  return ESSENTIAL_PATTERNS.some((pat) => itemName.includes(pat));
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

function resolveContainerBlock(bot: Bot, blockName: string): any | null {
  const mcData = require('minecraft-data')(bot.version);
  const block = mcData.blocksByName[blockName];
  if (!block) return null;
  return bot.findBlock({ matching: block.id, maxDistance: 32 });
}

export async function inspectContainer(bot: Bot, blockName: string, position?: Vec3): Promise<ActionResult> {
  const containerBlock = position ? bot.blockAt(position) : resolveContainerBlock(bot, blockName);
  if (!containerBlock) return { success: false, message: `No ${blockName} nearby` };

  const moved = await moveNear(bot, containerBlock.position.x, containerBlock.position.y, containerBlock.position.z, 3);
  if (!moved) return { success: false, message: `Could not reach nearby ${blockName}` };

  const container = await (bot as any).openContainer(containerBlock);
  try {
    const items = (container.containerItems?.() || [])
      .filter((item: any) => item)
      .reduce((acc: Record<string, number>, item: any) => {
        acc[item.name] = (acc[item.name] || 0) + item.count;
        return acc;
      }, {});
    const summary = Object.keys(items).length > 0
      ? Object.entries(items).map(([name, count]) => `${name}x${count}`).join(', ')
      : 'empty';
    return { success: true, message: `Inspected ${blockName}: ${summary}`, data: { items } };
  } catch (err: any) {
    return { success: false, message: `Inspect failed for ${blockName}: ${err.message}` };
  } finally {
    container.close();
  }
}

export async function withdrawFromContainer(bot: Bot, blockName: string, itemName: string, count = 1): Promise<ActionResult> {
  const mcData = require('minecraft-data')(bot.version);
  const item = mcData.itemsByName[itemName];
  if (!item) return { success: false, message: `Unknown item: ${itemName}` };

  const containerBlock = resolveContainerBlock(bot, blockName);
  if (!containerBlock) return { success: false, message: `No ${blockName} nearby` };

  const moved = await moveNear(bot, containerBlock.position.x, containerBlock.position.y, containerBlock.position.z, 3);
  if (!moved) return { success: false, message: `Could not reach nearby ${blockName}` };

  const container = await (bot as any).openContainer(containerBlock);
  try {
    await container.withdraw(item.id, null, count);
    return { success: true, message: `Withdrew ${count} ${itemName} from ${blockName}` };
  } catch (err: any) {
    return { success: false, message: `Withdraw failed from ${blockName}: ${err.message}` };
  } finally {
    container.close();
  }
}

export async function depositToContainer(bot: Bot, blockName: string, itemName: string, count = 1): Promise<ActionResult> {
  const mcData = require('minecraft-data')(bot.version);
  const item = mcData.itemsByName[itemName];
  if (!item) return { success: false, message: `Unknown item: ${itemName}` };

  const containerBlock = resolveContainerBlock(bot, blockName);
  if (!containerBlock) return { success: false, message: `No ${blockName} nearby` };

  const moved = await moveNear(bot, containerBlock.position.x, containerBlock.position.y, containerBlock.position.z, 3);
  if (!moved) return { success: false, message: `Could not reach nearby ${blockName}` };

  const container = await (bot as any).openContainer(containerBlock);
  try {
    await container.deposit(item.id, null, count);
    return { success: true, message: `Deposited ${count} ${itemName} into ${blockName}` };
  } catch (err: any) {
    return { success: false, message: `Deposit failed into ${blockName}: ${err.message}` };
  } finally {
    container.close();
  }
}

/**
 * Deposit all non-essential inventory items into the nearest chest.
 *
 * Essential items (tools, weapons, armor, food) are kept.
 * If `position` is provided, the bot walks to that block; otherwise it
 * searches for the nearest chest within 32 blocks.
 *
 * Returns a summary of deposited items with counts.
 */
export async function depositAllItems(
  bot: Bot,
  position?: Vec3,
): Promise<ActionResult> {
  // Locate the chest block
  const mcData = require('minecraft-data')(bot.version);
  let containerBlock: any;

  if (position) {
    containerBlock = bot.blockAt(position);
    if (!containerBlock) {
      return { success: false, message: 'No block found at the given position' };
    }
  } else {
    // Search for any chest-type block within 32 blocks
    const chestId = mcData.blocksByName['chest']?.id;
    const trappedChestId = mcData.blocksByName['trapped_chest']?.id;
    const barrelId = mcData.blocksByName['barrel']?.id;
    const matchingIds = [chestId, trappedChestId, barrelId].filter(
      (id): id is number => id !== undefined,
    );

    if (matchingIds.length === 0) {
      return { success: false, message: 'No chest block types recognised for this game version' };
    }

    containerBlock = bot.findBlock({
      matching: matchingIds,
      maxDistance: 32,
    });
  }

  if (!containerBlock) {
    return { success: false, message: 'No chest found within 32 blocks' };
  }

  // Navigate to the chest
  const moved = await moveNear(
    bot,
    containerBlock.position.x,
    containerBlock.position.y,
    containerBlock.position.z,
    3,
    15000,
  );
  if (!moved) {
    return { success: false, message: 'Could not reach the chest in time' };
  }

  // Gather non-essential items from the bot's inventory
  const itemsToDeposit = bot.inventory
    .items()
    .filter((item) => !isEssentialItem(item.name));

  if (itemsToDeposit.length === 0) {
    return {
      success: true,
      message: 'Nothing to deposit — inventory only contains essential items',
      data: { deposited: {} },
    };
  }

  // Open the container and deposit items one by one
  let container: any;
  try {
    container = await (bot as any).openContainer(containerBlock);
  } catch (err: any) {
    return { success: false, message: `Failed to open chest: ${err.message}` };
  }

  const deposited: Record<string, number> = {};
  const failures: string[] = [];

  for (const item of itemsToDeposit) {
    try {
      await container.deposit(item.type, item.metadata, item.count);
      deposited[item.name] = (deposited[item.name] || 0) + item.count;
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      // If the chest is full, stop trying
      if (msg.toLowerCase().includes('full') || msg.toLowerCase().includes('no room')) {
        failures.push(`Chest full — stopped depositing at ${item.name}`);
        break;
      }
      failures.push(`${item.name}: ${msg}`);
    }
  }

  try {
    container.close();
  } catch (_) {
    // Best-effort close
  }

  const totalDeposited = Object.values(deposited).reduce((s, n) => s + n, 0);
  const summary = Object.entries(deposited)
    .map(([name, count]) => `${name}x${count}`)
    .join(', ');

  if (totalDeposited === 0 && failures.length > 0) {
    return {
      success: false,
      message: `Deposit failed: ${failures.join('; ')}`,
      data: { deposited, failures },
    };
  }

  const message =
    failures.length > 0
      ? `Deposited ${totalDeposited} items (${summary}), with errors: ${failures.join('; ')}`
      : `Deposited ${totalDeposited} items: ${summary}`;

  return {
    success: true,
    message,
    data: { deposited, totalDeposited, ...(failures.length > 0 ? { failures } : {}) },
  };
}
