import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { ActionResult } from './types';
import { moveNearWithCleanup } from './moveHelper';

const FACE_VECTORS = [
  new Vec3(0, 1, 0),
  new Vec3(0, -1, 0),
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
];

export async function placeBlock(
  bot: Bot,
  blockType: string,
  x: number,
  y: number,
  z: number
): Promise<ActionResult> {
  if (typeof blockType !== 'string') {
    return { success: false, message: 'placeBlock requires blockType to be a string' };
  }

  const mcData = require('minecraft-data')(bot.version);
  const blockItem = mcData.itemsByName[blockType];
  if (!blockItem) {
    return { success: false, message: `Unknown block type: ${blockType}` };
  }

  const targetPos = new Vec3(x, y, z);
  const targetBlock = bot.blockAt(targetPos);
  if (targetBlock && targetBlock.name !== 'air' && targetBlock.name !== 'cave_air') {
    return { success: false, message: `Target ${x}, ${y}, ${z} is occupied by ${targetBlock.name}` };
  }

  // Check inventory for the block
  const item = bot.inventory.findInventoryItem(blockItem.id, null, false);
  if (!item) {
    return { success: false, message: `No ${blockType} in inventory` };
  }
  const initialCount = item.count;

  // Walk near the target location
  await moveNearWithCleanup(bot, { x, y, z, range: 3 }, 15000);

  // Equip + look once — both are independent of which face we end up using.
  try {
    await bot.equip(item, 'hand');
    await bot.lookAt(targetPos);
  } catch (err: any) {
    return { success: false, message: `Equip/look failed: ${err.message}` };
  }

  let lastError = 'No block to place against';
  for (const faceVector of FACE_VECTORS) {
    const referencePos = targetPos.minus(faceVector);
    const referenceBlock = bot.blockAt(referencePos);
    if (!referenceBlock || referenceBlock.name === 'air' || referenceBlock.name === 'cave_air') {
      continue;
    }

    try {
      await bot.placeBlock(referenceBlock, faceVector);

      const placedBlock = bot.blockAt(targetPos);
      const remaining = bot.inventory.findInventoryItem(blockItem.id, null, false)?.count ?? 0;
      if (placedBlock?.name === blockType || remaining < initialCount) {
        return {
          success: true,
          message: `Placed ${blockType} at ${x}, ${y}, ${z} using ${referenceBlock.name} at ${referencePos}`,
        };
      }

      lastError = `Placement did not verify at ${x}, ${y}, ${z}`;
    } catch (err: any) {
      lastError = `Place failed via ${referenceBlock.name} at ${referencePos}: ${err.message}`;
    }
  }

  return { success: false, message: lastError };
}
