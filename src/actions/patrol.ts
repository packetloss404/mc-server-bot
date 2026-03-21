import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { walkTo } from './walkTo';
import { sleep } from '../util/sleep';
import { ActionResult } from './types';

export async function patrol(
  bot: Bot,
  waypoints: Array<{ x: number; y: number; z: number }>,
  loops = 1,
  pauseMs = 2000
): Promise<ActionResult> {
  if (waypoints.length === 0) {
    return { success: false, message: 'No waypoints provided' };
  }

  let loopCount = 0;
  const maxLoops = loops === -1 ? Infinity : loops;

  while (loopCount < maxLoops) {
    for (const wp of waypoints) {
      const result = await walkTo(bot, wp.x, wp.y, wp.z);
      if (!result.success) return result;
      await sleep(pauseMs);
    }
    loopCount++;
  }

  return { success: true, message: `Completed ${loopCount} patrol loops` };
}
