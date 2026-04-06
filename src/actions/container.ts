import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ActionResult } from './types';
import { moveNearWithCleanup } from './moveHelper';

async function moveNear(bot: Bot, x: number, y: number, z: number, range = 3, timeoutMs = 15000): Promise<boolean> {
  return moveNearWithCleanup(bot, { x, y, z, range }, timeoutMs);
}

const CONTAINER_OPEN_TIMEOUT = 10000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
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

  try {
    const container: any = await withTimeout((bot as any).openContainer(containerBlock), CONTAINER_OPEN_TIMEOUT, 'openContainer');
    const items = (container.containerItems?.() || [])
      .filter((item: any) => item)
      .reduce((acc: Record<string, number>, item: any) => {
        acc[item.name] = (acc[item.name] || 0) + item.count;
        return acc;
      }, {});
    container.close();
    const summary = Object.keys(items).length > 0
      ? Object.entries(items).map(([name, count]) => `${name}x${count}`).join(', ')
      : 'empty';
    return { success: true, message: `Inspected ${blockName}: ${summary}`, data: { items } };
  } catch (err: any) {
    return { success: false, message: `Inspect failed for ${blockName}: ${err.message}` };
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

  try {
    const container: any = await withTimeout((bot as any).openContainer(containerBlock), CONTAINER_OPEN_TIMEOUT, 'openContainer');
    await container.withdraw(item.id, null, count);
    container.close();
    return { success: true, message: `Withdrew ${count} ${itemName} from ${blockName}` };
  } catch (err: any) {
    return { success: false, message: `Withdraw failed from ${blockName}: ${err.message}` };
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

  try {
    const container: any = await withTimeout((bot as any).openContainer(containerBlock), CONTAINER_OPEN_TIMEOUT, 'openContainer');
    await container.deposit(item.id, null, count);
    container.close();
    return { success: true, message: `Deposited ${count} ${itemName} into ${blockName}` };
  } catch (err: any) {
    return { success: false, message: `Deposit failed into ${blockName}: ${err.message}` };
  }
}
