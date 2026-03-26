import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

export async function walkTo(bot: Bot, x: number, y: number, z: number, range = 2): Promise<ActionResult> {
  return new Promise((resolve) => {
    let resolved = false;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      bot.removeListener('goal_reached', onReached);
      bot.removeListener('path_update', onPathUpdate);
    };

    const timeout = setTimeout(() => {
      cleanup();
      bot.pathfinder.stop();
      resolve({ success: false, message: 'Pathfinding timeout' });
    }, 30000);

    const onReached = () => {
      cleanup();
      resolve({ success: true, message: `Reached ${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}` });
    };

    const onPathUpdate = (r: any) => {
      if (r.status === 'noPath') {
        cleanup();
        bot.pathfinder.stop();
        resolve({ success: false, message: 'No path found' });
      }
    };

    bot.once('goal_reached', onReached);
    bot.on('path_update', onPathUpdate);
    bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, range));
  });
}
