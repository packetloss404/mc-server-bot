import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

export async function followPlayer(
  bot: Bot,
  playerName: string,
  duration = 60000,
  followDistance = 2
): Promise<ActionResult> {
  const player = bot.players[playerName];
  if (!player?.entity) {
    return { success: false, message: `Player ${playerName} not found or not visible` };
  }

  bot.pathfinder.setGoal(new goals.GoalFollow(player.entity, followDistance), true);

  return new Promise((resolve) => {
    let settled = false;
    const done = (result: ActionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      bot.pathfinder.stop();
      bot.removeListener('playerLeft', onPlayerLeft);
      bot.removeListener('path_update' as any, onPathUpdate);
      resolve(result);
    };

    const timeout = setTimeout(() => {
      done({ success: true, message: 'Follow duration ended' });
    }, duration);

    const onPlayerLeft = (p: { username: string }) => {
      if (p.username === playerName) {
        done({ success: true, message: 'Player left' });
      }
    };

    const onPathUpdate = (r: any) => {
      if (r?.status === 'noPath') {
        done({ success: false, message: `No path to player ${playerName}` });
      }
    };

    bot.on('playerLeft', onPlayerLeft);
    bot.on('path_update' as any, onPathUpdate);
  });
}
