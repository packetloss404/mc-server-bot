import { Bot } from 'mineflayer';
import { ActionResult } from './types';
import { logger } from '../util/logger';

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
    count: 64,
  });

  logger.info({
    bot: bot.username,
    blockType,
    requestedCount: count,
    candidatePositions: positions.length,
  }, 'mineBlock candidate scan complete');

  if (positions.length === 0) {
    return {
      success: false,
      message: `No ${blockType} nearby, please explore first`,
      data: { mined: 0 },
    };
  }

  const targets = positions
    .map((pos: any) => bot.blockAt(pos))
    .filter((block: any) => block)
    .sort((a: any, b: any) =>
      a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))
    .slice(0, Math.min(count, 16));

  logger.info({
    bot: bot.username,
    blockType,
    requestedCount: count,
    resolvedTargets: targets.length,
    closestDistance: targets.length > 0
      ? Number(Math.min(...targets.map((block: any) => block.position.distanceTo(bot.entity.position))).toFixed(2))
      : null,
  }, 'mineBlock targets prepared');

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
