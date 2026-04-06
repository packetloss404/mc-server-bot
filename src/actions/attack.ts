import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

const FLEE_HEALTH_THRESHOLD = 8; // 4 hearts

export async function attack(bot: Bot, entityName: string, maxDuration = 30000): Promise<ActionResult> {
  if (typeof entityName !== 'string') {
    return { success: false, message: 'killMob requires entityName to be a string' };
  }
  if (typeof maxDuration !== 'number') {
    return { success: false, message: 'killMob requires maxDuration to be a number' };
  }

  const target = bot.nearestEntity((entity) => {
    if (entity.type === 'player' && (entity as any).username === entityName) return true;
    if (entity.name === entityName) return true;
    if ((entity as any).username === entityName) return true;
    return false;
  });

  if (!target) {
    return { success: false, message: `No ${entityName} nearby, please explore first` };
  }

  bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true);

  return new Promise<ActionResult>((resolve, reject) => {
    let hits = 0;
    const startTime = Date.now();
    let droppedItem: any = null;
    let finished = false;

    const onEntityDead = (entity: any) => {
      if (entity === target) {
        cleanup();
        finish(true, `${entityName} killed after ${hits} hits`);
      }
    };

    const onEntitySpawn = (entity: any) => {
      // Filter for item drops near the target's last known position
      if (entity.type === 'object' && entity.objectType === 'Item' &&
          target.position && entity.position &&
          target.position.distanceTo(entity.position) <= 3) {
        droppedItem = entity;
      }
    };

    const onBotDeath = () => {
      cleanup();
      reject(new Error(`Bot died while fighting ${entityName}`));
    };

    const cleanup = () => {
      clearInterval(attackInterval);
      clearTimeout(timeoutId);
      bot.pathfinder.stop();
      bot.removeListener('entityDead', onEntityDead);
      bot.removeListener('entitySpawn', onEntitySpawn);
      bot.removeListener('death', onBotDeath);
    };

    const finish = async (success: boolean, message: string) => {
      if (finished) return;
      finished = true;
      if (success && droppedItem) {
        try {
          await (bot as any).collectBlock.collect(droppedItem, { ignoreNoPath: true });
          resolve({ success: true, message: `${message}. Collected nearby drops.`, data: { hits } });
          return;
        } catch {
          // ignore loot collection failure
        }
      }
      if (success) {
        resolve({ success: true, message, data: { hits } });
      } else {
        reject(new Error(message));
      }
    };

    bot.on('entityDead', onEntityDead);
    bot.on('entitySpawn', onEntitySpawn);
    bot.on('death', onBotDeath);

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Failed to kill ${entityName} within ${Math.round(maxDuration / 1000)}s`));
    }, maxDuration);

    const attackInterval = setInterval(() => {
      if (Date.now() - startTime > maxDuration) {
        return;
      }

      // Flee if health is critically low
      if (bot.health < FLEE_HEALTH_THRESHOLD) {
        cleanup();
        bot.pathfinder.stop();
        // Move away from target
        const pos = bot.entity.position;
        const away = pos.offset(
          pos.x - target.position.x,
          0,
          pos.z - target.position.z
        ).normalize().scale(16);
        const fleePos = pos.plus(away);
        bot.pathfinder.setGoal(new goals.GoalNear(fleePos.x, fleePos.y, fleePos.z, 2));
        resolve({
          success: false,
          message: `Fleeing from ${entityName} - health critically low (${bot.health.toFixed(1)})`,
          data: { hits },
        });
        return;
      }

      if (!target.isValid) {
        cleanup();
        void finish(true, `Target ${entityName} is no longer valid after ${hits} hits`);
        return;
      }

      const dist = bot.entity.position.distanceTo(target.position);
      if (dist < 3) {
        bot.attack(target);
        hits++;
      }
    }, 500);
  }).catch((err: any) => ({ success: false, message: err.message, data: { hits: 0 } }));
}
