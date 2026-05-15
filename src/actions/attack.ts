import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';

const FLEE_HEALTH_THRESHOLD = 8; // 4 hearts
const KITE_HEALTH_THRESHOLD = 14; // 7 hearts — switch to conservative ranged/kite mode
const SWORD_TIERS = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];

// Hostile mobs where keeping range is important (explosions, ranged attacks, etc.)
const RANGED_HOSTILES = new Set(['creeper', 'skeleton', 'witch', 'stray', 'pillager']);

function equipBestSword(bot: Bot): Promise<void> | undefined {
  const items = bot.inventory.items();
  for (const tier of SWORD_TIERS) {
    const sword = items.find((i) => i.name === `${tier}_sword`);
    if (sword) return bot.equip(sword, 'hand').catch(() => undefined);
  }
  return undefined;
}

function findBow(bot: Bot) {
  return bot.inventory.items().find((i) => i.name === 'bow');
}

function hasArrows(bot: Bot): boolean {
  return bot.inventory.items().some((i) => i.name === 'arrow');
}

function retreatFrom(bot: Bot, target: any, distance: number): void {
  const pos = bot.entity.position;
  const dx = pos.x - target.position.x;
  const dz = pos.z - target.position.z;
  const mag = Math.sqrt(dx * dx + dz * dz) || 1;
  const fleeX = pos.x + (dx / mag) * distance;
  const fleeZ = pos.z + (dz / mag) * distance;
  bot.pathfinder.setGoal(new goals.GoalNear(fleeX, pos.y, fleeZ, 1), true);
}

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

  const isCreeper = target.name === 'creeper';
  const isSkeleton = target.name === 'skeleton' || target.name === 'stray';

  // For skeletons, prefer bow + arrows if available — staying out of melee range
  // avoids most of their kiting damage.
  let usingBow = false;
  if (isSkeleton) {
    const bow = findBow(bot);
    if (bow && hasArrows(bot)) {
      try {
        await bot.equip(bow, 'hand');
        usingBow = true;
      } catch {
        // fall back to sword
      }
    }
  }

  if (!usingBow) {
    // Equip best available sword — fighting with bare hands is 2-3× slower
    // and the bot takes more damage during the longer engagement.
    await equipBestSword(bot);
  }

  // Creepers explode at ~3-block range; keep follow distance well outside the
  // detonation radius and rely on hit-and-retreat inside the interval.
  const followDist = isCreeper ? 5 : 2;
  bot.pathfinder.setGoal(new goals.GoalFollow(target, followDist), true);

  return new Promise<ActionResult>((resolve, reject) => {
    let hits = 0;
    const startTime = Date.now();
    let droppedItem: any = null;
    let finished = false;
    let drawingBow = false;
    let bowDrawStart = 0;

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
      if (drawingBow) {
        try { bot.deactivateItem(); } catch { /* ignore */ }
      }
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

      // Creeper-specific hit-and-retreat: stay in the 3.5–5 block band.
      if (isCreeper) {
        if (dist < 4) {
          // Too close — retreat 6 blocks before attacking.
          retreatFrom(bot, target, 6);
          return;
        }
        if (dist >= 3.5 && dist <= 5) {
          bot.attack(target);
          hits++;
        }
        // dist > 5: pathfinder follow will close the gap on its own.
        return;
      }

      // Generic kite mode for ranged hostiles when health is low-but-not-flee.
      const inKiteMode = bot.health < KITE_HEALTH_THRESHOLD && RANGED_HOSTILES.has(target.name || '');
      if (inKiteMode) {
        if (dist < 4) {
          retreatFrom(bot, target, 5);
          return;
        }
        if (usingBow) {
          // Charge and release bow shots while keeping distance.
          try {
            (bot as any).lookAt(target.position.offset(0, target.height || 1.6, 0), true);
          } catch { /* ignore */ }
          if (!drawingBow) {
            try {
              bot.activateItem();
              drawingBow = true;
              bowDrawStart = Date.now();
            } catch { /* ignore */ }
          } else if (Date.now() - bowDrawStart >= 1200) {
            try {
              bot.deactivateItem();
              hits++;
            } catch { /* ignore */ }
            drawingBow = false;
          }
          return;
        }
        // No bow — only swing when in a safe melee window.
        if (dist >= 3.5 && dist <= 4.5) {
          bot.attack(target);
          hits++;
        }
        return;
      }

      // Skeleton bow combat when healthy: snipe at range, retreat if too close.
      if (usingBow) {
        if (dist < 5) {
          retreatFrom(bot, target, 6);
          return;
        }
        try {
          (bot as any).lookAt(target.position.offset(0, target.height || 1.6, 0), true);
        } catch { /* ignore */ }
        if (!drawingBow) {
          try {
            bot.activateItem();
            drawingBow = true;
            bowDrawStart = Date.now();
          } catch { /* ignore */ }
        } else if (Date.now() - bowDrawStart >= 1200) {
          try {
            bot.deactivateItem();
            hits++;
          } catch { /* ignore */ }
          drawingBow = false;
        }
        return;
      }

      // Default melee engagement.
      if (dist < 3) {
        bot.attack(target);
        hits++;
      }
    }, 500);
  }).catch((err: any) => ({ success: false, message: err.message, data: { hits: 0 } }));
}
