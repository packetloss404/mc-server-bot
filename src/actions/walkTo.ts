import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

export async function walkTo(bot: Bot, x: number, y: number, z: number, range = 2): Promise<ActionResult> {
  return new Promise((resolve) => {
    let finished = false;

    const done = (result: ActionResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      bot.removeListener('goal_reached', onReached);
      bot.removeListener('path_update', onPathUpdate);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      bot.pathfinder.stop();
      done({ success: false, message: 'Pathfinding timeout' });
    }, 30000);

    const onReached = () => {
      done({ success: true, message: `Reached ${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}` });
    };

    const onPathUpdate = (r: any) => {
      if (r.status === 'noPath') {
        bot.pathfinder.stop();
        done({ success: false, message: 'No path found' });
      }
    };

    bot.once('goal_reached', onReached);
    bot.on('path_update', onPathUpdate);
    bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, range));
  });
}
