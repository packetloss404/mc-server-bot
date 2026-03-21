import { Bot } from 'mineflayer';
import { walkTo } from './walkTo';
import { ActionResult } from './types';

export async function wander(bot: Bot, radius = 15): Promise<ActionResult> {
  const pos = bot.entity.position;
  const dx = (Math.random() - 0.5) * 2 * radius;
  const dz = (Math.random() - 0.5) * 2 * radius;

  return walkTo(bot, pos.x + dx, pos.y, pos.z + dz, 2);
}
