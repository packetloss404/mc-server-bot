import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { walkTo } from './walkTo';
import { sleep } from '../util/sleep';
import { ActionResult } from './types';

export interface PatrolHandle {
  cancel(): void;
  promise: Promise<ActionResult>;
}

export function patrol(
  bot: Bot,
  waypoints: Array<{ x: number; y: number; z: number }>,
  loops = 1,
  pauseMs = 2000
): PatrolHandle {
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    bot.pathfinder.stop();
  };

  const promise = (async (): Promise<ActionResult> => {
    if (waypoints.length === 0) {
      return { success: false, message: 'No waypoints provided' };
    }

    let loopCount = 0;
    const maxLoops = loops === -1 ? Infinity : loops;

    while (loopCount < maxLoops) {
      for (const wp of waypoints) {
        if (cancelled) {
          return { success: true, message: `Patrol cancelled after ${loopCount} loops` };
        }

        if (!bot.entity) {
          return { success: false, message: 'Bot disconnected during patrol' };
        }

        if (bot.health !== undefined && bot.health <= 0) {
          return { success: false, message: 'Bot died during patrol' };
        }

        const result = await walkTo(bot, wp.x, wp.y, wp.z);
        if (!result.success) return result;
        await sleep(pauseMs);
      }
      loopCount++;
    }

    return { success: true, message: `Completed ${loopCount} patrol loops` };
  })();

  return { cancel, promise };
}
