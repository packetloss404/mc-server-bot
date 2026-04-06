import { Bot } from 'mineflayer';
import { ActionResult } from './types';
import { moveNearWithCleanup } from './moveHelper';

export async function walkTo(bot: Bot, x: number, y: number, z: number, range = 2): Promise<ActionResult> {
  const reached = await moveNearWithCleanup(bot, { x, y, z, range }, 30000);

  if (reached) {
    return { success: true, message: `Reached ${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}` };
  }
  return { success: false, message: 'Pathfinding failed or timed out' };
}
