import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { Entity } from 'prismarine-entity';
import { ActionResult } from './types';

export async function lookAt(bot: Bot, target: Vec3 | string): Promise<ActionResult> {
  let pos: Vec3;

  if (typeof target === 'string') {
    // Look at a player by name
    const player = bot.players[target];
    if (!player?.entity) {
      return { success: false, message: `Player ${target} not found` };
    }
    pos = player.entity.position.offset(0, player.entity.height, 0);
  } else {
    pos = target;
  }

  await bot.lookAt(pos, true);
  return { success: true };
}
