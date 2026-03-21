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
    const timeout = setTimeout(() => {
      bot.pathfinder.stop();
      resolve({ success: true, message: 'Follow duration ended' });
    }, duration);

    const onPlayerLeft = (p: { username: string }) => {
      if (p.username === playerName) {
        clearTimeout(timeout);
        bot.pathfinder.stop();
        bot.removeListener('playerLeft', onPlayerLeft);
        resolve({ success: true, message: 'Player left' });
      }
    };

    bot.on('playerLeft', onPlayerLeft);
  });
}
