import { Bot } from 'mineflayer';
import { ActionResult } from './types';

export async function mineBlock(bot: Bot, blockType: string, count = 1): Promise<ActionResult> {
  if (typeof blockType !== 'string') {
    return { success: false, message: 'mineBlock requires blockType to be a string' };
  }
  if (typeof count !== 'number') {
    return { success: false, message: 'mineBlock requires count to be a number' };
  }

  const mcData = require('minecraft-data')(bot.version);
  const blockInfo = mcData.blocksByName[blockType];
  if (!blockInfo) {
    return { success: false, message: `Unknown block type: ${blockType}` };
  }

  const positions = bot.findBlocks({
    matching: [blockInfo.id],
    maxDistance: 32,
    count: 1024,
  });

  if (positions.length === 0) {
    return {
      success: false,
      message: `No ${blockType} nearby, please explore first`,
      data: { mined: 0 },
    };
  }

  const targets = positions
    .map((pos: any) => bot.blockAt(pos))
    .filter((block: any) => block);

  if (targets.length === 0) {
    return {
      success: false,
      message: `Found ${blockType} positions but could not resolve blocks`,
      data: { mined: 0 },
    };
  }

  try {
    await (bot as any).collectBlock.collect(targets, {
      ignoreNoPath: true,
      count,
    });
    return {
      success: true,
      message: `Mined up to ${count} ${blockType}`,
      data: { mined: count },
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Mining error for ${blockType}: ${err.message}`,
      data: { mined: 0 },
    };
  }
}
