import { Bot } from 'mineflayer';
import { Entity } from 'prismarine-entity';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

export async function attack(bot: Bot, entityName: string, maxDuration = 30000): Promise<ActionResult> {
  const target = bot.nearestEntity((entity) => {
    if (entity.type === 'player' && (entity as any).username === entityName) return true;
    if (entity.name === entityName) return true;
    return false;
  });

  if (!target) {
    return { success: false, message: `Entity ${entityName} not found nearby` };
  }

  bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);

  return new Promise((resolve) => {
    let hits = 0;
    const startTime = Date.now();

    const attackInterval = setInterval(() => {
      if (Date.now() - startTime > maxDuration || !target.isValid) {
        clearInterval(attackInterval);
        bot.pathfinder.stop();
        resolve({ success: true, message: `Attacked ${entityName} ${hits} times`, data: { hits } });
        return;
      }

      const dist = bot.entity.position.distanceTo(target.position);
      if (dist < 3) {
        bot.attack(target);
        hits++;
      }
    }, 500);
  });
}
