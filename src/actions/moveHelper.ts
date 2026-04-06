import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';

/**
 * Shared movement helper that properly cleans up all event listeners.
 * Sets a pathfinder goal, listens for goal_reached and path_update (noPath),
 * and always removes listeners in a finally block with a timeout guard.
 */
export function moveNearWithCleanup(
  bot: Bot,
  goal: { x: number; y: number; z: number; range?: number },
  timeoutMs = 15000,
): Promise<boolean> {
  const range = goal.range ?? 2;

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const settle = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      bot.removeListener('goal_reached', onGoalReached);
      bot.removeListener('path_update', onPathUpdate);
      resolve(result);
    };

    const onGoalReached = () => {
      settle(true);
    };

    const onPathUpdate = (r: any) => {
      if (r.status === 'noPath') {
        bot.pathfinder.stop();
        settle(false);
      }
    };

    const timer = setTimeout(() => {
      bot.pathfinder.stop();
      settle(false);
    }, timeoutMs);

    bot.on('goal_reached', onGoalReached);
    bot.on('path_update', onPathUpdate);
    bot.pathfinder.setGoal(new goals.GoalNear(goal.x, goal.y, goal.z, range));
  });
}
