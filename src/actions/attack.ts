import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

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

    const onEntityGone = (entity: any) => {
      if (entity === target) {
        cleanup();
        finish(true, `${entityName} removed from world after ${hits} hits`);
      }
    };

    const onItemDrop = (item: any) => {
      if (target.position && item.position && target.position.distanceTo(item.position) <= 1.5) {
        droppedItem = item;
      }
    };

    const cleanup = () => {
      clearInterval(attackInterval);
      clearTimeout(timeoutId);
      bot.pathfinder.stop();
      bot.removeListener('entityGone' as any, onEntityGone);
      bot.removeListener('itemDrop' as any, onItemDrop);
    };

    const finish = async (success: boolean, message: string) => {
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

    bot.on('entityGone' as any, onEntityGone);
    bot.on('itemDrop' as any, onItemDrop);

    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error(`Failed to kill ${entityName} within ${Math.round(maxDuration / 1000)}s`));
    }, maxDuration);

    const attackInterval = setInterval(() => {
      if (Date.now() - startTime > maxDuration) {
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
