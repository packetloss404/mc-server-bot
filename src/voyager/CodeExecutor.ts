import vm from 'vm';
import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { mineBlock } from '../actions/mineBlock';
import { craft } from '../actions/craft';
import { placeBlock } from '../actions/placeBlock';
import { attack } from '../actions/attack';
import { smelt } from '../actions/smelt';
import { depositToContainer, withdrawFromContainer } from '../actions/container';

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

export interface ExecuteParams {
  functionCode: string;
  execCode: string;
  allSkillCode: string;
}

type InterruptState = {
  interrupted: boolean;
  reason: string;
  listeners: Set<(reason: string) => void>;
};

export class CodeExecutor {
  private timeoutMs: number;
  private currentInterrupt: InterruptState | null = null;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  requestInterrupt(reason = 'Execution interrupted'): void {
    if (!this.currentInterrupt || this.currentInterrupt.interrupted) return;
    this.currentInterrupt.interrupted = true;
    this.currentInterrupt.reason = reason;
    for (const listener of this.currentInterrupt.listeners) {
      listener(reason);
    }
    this.currentInterrupt.listeners.clear();
  }

  async execute(bot: Bot, params: ExecuteParams | string): Promise<ExecutionResult> {
    const logs: string[] = [];
    const startPos = bot.entity.position.clone();
    const interruptState: InterruptState = {
      interrupted: false,
      reason: 'Execution interrupted',
      listeners: new Set(),
    };
    this.currentInterrupt = interruptState;

    const throwIfInterrupted = () => {
      if (interruptState.interrupted) {
        throw new Error(`Execution interrupted: ${interruptState.reason}`);
      }
    };

    const onInterrupt = (listener: (reason: string) => void) => {
      interruptState.listeners.add(listener);
      return () => interruptState.listeners.delete(listener);
    };

    const pushPos = (label: string) => {
      const pos = bot.entity.position;
      logs.push(`${label} pos=(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) moving=${bot.pathfinder.isMoving()}`);
    };

    const addMovementTrace = (label: string) => {
      const onGoalReached = () => {
        const pos = bot.entity.position;
        logs.push(`[trace:${label}] goal_reached at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
      };
      const onPathReset = (reason?: string) => logs.push(`[trace:${label}] path_reset reason=${String(reason || 'unknown')}`);
      const onPathStop = () => logs.push(`[trace:${label}] path_stop`);
      const onDeath = () => logs.push(`[trace:${label}] death while primitive running`);
      const onSpawn = () => {
        const pos = bot.entity.position;
        logs.push(`[trace:${label}] spawn at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
      };
      const onPathUpdate = (result: any) => {
        const status = result?.status || 'unknown';
        const nodes = Array.isArray(result?.path) ? result.path.length : 0;
        logs.push(`[trace:${label}] path_update status=${status} nodes=${nodes}`);
      };

      bot.on('goal_reached' as any, onGoalReached);
      bot.on('path_reset' as any, onPathReset);
      bot.on('path_stop' as any, onPathStop);
      bot.on('death' as any, onDeath);
      bot.on('spawn' as any, onSpawn);
      bot.on('path_update' as any, onPathUpdate);

      return () => {
        bot.removeListener('goal_reached' as any, onGoalReached);
        bot.removeListener('path_reset' as any, onPathReset);
        bot.removeListener('path_stop' as any, onPathStop);
        bot.removeListener('death' as any, onDeath);
        bot.removeListener('spawn' as any, onSpawn);
        bot.removeListener('path_update' as any, onPathUpdate);
      };
    };

    const interruptibleDelay = (ms: number) => {
      throwIfInterrupted();
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          resolve();
        }, ms);
        const cleanup = onInterrupt((reason) => {
          clearTimeout(timeout);
          cleanup();
          reject(new Error(`Execution interrupted: ${reason}`));
        });
      });
    };

    pushPos('[exec] start');

    const botProxy = this.createBotProxy(bot, logs, interruptibleDelay);

    const sandbox = {
      bot: botProxy,
      Vec3,
      goals,
      console: {
        log: (...args: any[]) => logs.push(args.map(String).join(' ')),
        error: (...args: any[]) => logs.push('[ERROR] ' + args.map(String).join(' ')),
      },
      setTimeout: (fn: (...args: any[]) => void, ms: number) => {
        const safeMs = Math.min(ms, this.timeoutMs);
        return setTimeout(fn, safeMs);
      },
      clearTimeout,
      Promise,

      mineBlock: async (name: string, count = 1) => {
        throwIfInterrupted();
        const beforeItems = bot.inventory.items().map((i) => `${i.name}x${i.count}`).join(', ') || 'empty';
        logs.push(`[primitive] mineBlock("${name}", ${count})`);
        const result = await mineBlock(bot, name, count);
        logs.push(`[primitive] mineBlock result: ${result.message}`);
        const afterItems = bot.inventory.items().map((i) => `${i.name}x${i.count}`).join(', ') || 'empty';
        logs.push(`[primitive] mineBlock inventory before=${beforeItems} after=${afterItems}`);
        return result;
      },
      craftItem: async (name: string, count = 1) => {
        throwIfInterrupted();
        logs.push(`[primitive] craftItem("${name}", ${count})`);
        const result = await craft(bot, name, count);
        logs.push(`[primitive] craftItem result: ${result.message}`);
        return result;
      },
      smeltItem: async (itemName: string, fuelName: string, count = 1) => {
        throwIfInterrupted();
        logs.push(`[primitive] smeltItem("${itemName}", "${fuelName}", ${count})`);
        const result = await smelt(bot, itemName, fuelName, count);
        logs.push(`[primitive] smeltItem result: ${result.message}`);
        return result;
      },
      placeItem: async (name: string, x: number, y: number, z: number) => {
        throwIfInterrupted();
        logs.push(`[primitive] placeItem("${name}", ${x}, ${y}, ${z})`);
        const result = await placeBlock(bot, name, x, y, z);
        logs.push(`[primitive] placeItem result: ${result.message}`);
        return result;
      },
      withdrawItem: async (containerName: string, itemName: string, count = 1) => {
        throwIfInterrupted();
        logs.push(`[primitive] withdrawItem("${containerName}", "${itemName}", ${count})`);
        const result = await withdrawFromContainer(bot, containerName, itemName, count);
        logs.push(`[primitive] withdrawItem result: ${result.message}`);
        return result;
      },
      depositItem: async (containerName: string, itemName: string, count = 1) => {
        throwIfInterrupted();
        logs.push(`[primitive] depositItem("${containerName}", "${itemName}", ${count})`);
        const result = await depositToContainer(bot, containerName, itemName, count);
        logs.push(`[primitive] depositItem result: ${result.message}`);
        return result;
      },
      killMob: async (name: string, maxDuration = 30000) => {
        throwIfInterrupted();
        logs.push(`[primitive] killMob("${name}")`);
        const result = await attack(bot, name, maxDuration);
        logs.push(`[primitive] killMob result: ${result.message}`);
        return result;
      },
      moveTo: async (x: number, y: number, z: number, range = 2, timeoutSec = 15) => {
        throwIfInterrupted();
        const cleanupTrace = addMovementTrace('moveTo');
        const start = bot.entity.position;
        const targetSummary = `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
        logs.push(`[primitive] moveTo target=${targetSummary} range=${range} timeoutSec=${timeoutSec}`);
        logs.push(`[primitive] moveTo startPos=(${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)})`);
        bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, range));
        return new Promise<boolean>((resolve, reject) => {
          const timeout = setTimeout(() => {
            bot.pathfinder.stop();
            const pos = bot.entity.position;
            logs.push(`[primitive] moveTo: timed out, stopping at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
            cleanupTrace();
            cleanupInterrupt();
            resolve(false);
          }, timeoutSec * 1000);
          const cleanupInterrupt = onInterrupt((reason) => {
            clearTimeout(timeout);
            bot.pathfinder.stop();
            logs.push(`[primitive] moveTo: interrupted (${reason})`);
            cleanupTrace();
            cleanupInterrupt();
            reject(new Error(`Execution interrupted: ${reason}`));
          });
          bot.once('goal_reached' as any, () => {
            clearTimeout(timeout);
            const pos = bot.entity.position;
            logs.push(`[primitive] moveTo: goal reached at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
            cleanupTrace();
            cleanupInterrupt();
            resolve(true);
          });
        });
      },
      exploreUntil: async (direction: { x: number; y: number; z: number }, maxTime = 60, callback: () => any) => {
        throwIfInterrupted();
        const cleanupTrace = addMovementTrace('exploreUntil');
        logs.push(`[primitive] exploreUntil(${JSON.stringify(direction)}, ${maxTime}s)`);
        if (!direction || typeof direction.x !== 'number' || typeof direction.y !== 'number' || typeof direction.z !== 'number') {
          logs.push(`[primitive] exploreUntil: invalid direction argument ${JSON.stringify(direction)}`);
          cleanupTrace();
          throw new Error('exploreUntil requires direction { x, y, z }');
        }
        const startTime = Date.now();
        const dir = new Vec3(direction.x, direction.y, direction.z);
        let iteration = 0;
        while (Date.now() - startTime < maxTime * 1000) {
          throwIfInterrupted();
          iteration++;
          const found = callback();
          if (found) {
            const blockPos = (found as any)?.position;
            logs.push(`[primitive] exploreUntil: found target on iteration=${iteration}${blockPos ? ` at (${blockPos.x}, ${blockPos.y}, ${blockPos.z})` : ''}`);
            cleanupTrace();
            return found;
          }
          const pos = bot.entity.position;
          const target = pos.offset(dir.x * 16, dir.y * 16, dir.z * 16);
          logs.push(`[primitive] exploreUntil: iteration=${iteration} moving from (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) toward (${target.x.toFixed(1)}, ${target.y.toFixed(1)}, ${target.z.toFixed(1)})`);
          bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 3));
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              bot.pathfinder.stop();
              logs.push(`[primitive] exploreUntil: iteration=${iteration} timed out waiting for goal`);
              cleanupInterrupt();
              resolve();
            }, 10000);
            const cleanupInterrupt = onInterrupt((reason) => {
              clearTimeout(timeout);
              bot.pathfinder.stop();
              logs.push(`[primitive] exploreUntil: interrupted (${reason}) on iteration=${iteration}`);
              cleanupInterrupt();
              reject(new Error(`Execution interrupted: ${reason}`));
            });
            bot.once('goal_reached' as any, () => {
              clearTimeout(timeout);
              const reachedPos = bot.entity.position;
              logs.push(`[primitive] exploreUntil: iteration=${iteration} goal reached at (${reachedPos.x.toFixed(1)}, ${reachedPos.y.toFixed(1)}, ${reachedPos.z.toFixed(1)})`);
              cleanupInterrupt();
              resolve();
            });
          });
        }
        logs.push('[primitive] exploreUntil: timed out');
        cleanupTrace();
        return null;
      },
    };

    let wrappedCode: string;
    if (typeof params === 'string') {
      wrappedCode = `(async () => { ${params} })();`;
    } else {
      wrappedCode = `
(async () => {
  ${params.allSkillCode}

  ${params.functionCode}

  ${params.execCode}
})();
`;
    }

    try {
      const context = vm.createContext(sandbox);
      const script = new vm.Script(wrappedCode, { filename: 'skill.js' });
      const resultPromise = script.runInContext(context, { timeout: 5000 });

      await Promise.race([
        resultPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Execution timed out')), this.timeoutMs)
        ),
        new Promise((_, reject) => {
          const cleanup = onInterrupt((reason) => {
            cleanup();
            reject(new Error(`Execution interrupted: ${reason}`));
          });
        }),
      ]);

      pushPos('[exec] end');
      logs.push(`[exec] movedDistance=${startPos.distanceTo(bot.entity.position).toFixed(2)}`);
      return { success: true, output: logs.join('\n') };
    } catch (err: any) {
      pushPos('[exec] error');
      logs.push(`[exec] movedDistance=${startPos.distanceTo(bot.entity.position).toFixed(2)}`);
      return {
        success: false,
        output: logs.join('\n'),
        error: err.message || String(err),
      };
    } finally {
      if (this.currentInterrupt === interruptState) {
        this.currentInterrupt = null;
      }
    }
  }

  private createBotProxy(bot: Bot, logs: string[], interruptibleDelay: (ms: number) => Promise<void>) {
    return {
      get entity() { return { position: bot.entity.position, velocity: bot.entity.velocity, height: (bot.entity as any).height || 1.8 }; },
      get health() { return bot.health; },
      get food() { return bot.food; },
      get time() { return { timeOfDay: bot.time.timeOfDay, day: bot.time.day }; },
      get isRaining() { return bot.isRaining; },
      get inventory() {
        return {
          items: () => bot.inventory.items().map((i) => ({ name: i.name, count: i.count, slot: i.slot })),
        };
      },
      chat: (msg: string) => {
        const safe = String(msg).slice(0, 256);
        if (!safe.startsWith('/')) logs.push(`[chat] ${safe}`);
      },
      pathfinder: {
        setGoal: (goal: any, dynamic?: boolean) => bot.pathfinder.setGoal(goal, dynamic),
        setMovements: (m: any) => bot.pathfinder.setMovements(m),
        isMoving: () => bot.pathfinder.isMoving(),
        stop: () => bot.pathfinder.stop(),
      },
      lookAt: (pos: Vec3) => bot.lookAt(pos),
      look: (yaw: number, pitch: number) => bot.look(yaw, pitch),
      dig: async (block: any) => { if (block) await bot.dig(block); },
      placeBlock: async (block: any, faceVec: Vec3) => { if (block) await bot.placeBlock(block, faceVec); },
      blockAt: (pos: Vec3) => {
        const b = bot.blockAt(pos);
        if (!b) return null;
        return { name: b.name, position: b.position, hardness: b.hardness };
      },
      findBlock: (opts: { matching: (b: any) => boolean; maxDistance: number; count?: number }) => {
        return bot.findBlock({
          matching: opts.matching,
          maxDistance: opts.maxDistance,
          count: opts.count || 1,
        });
      },
      nearestEntity: (filter?: (e: any) => boolean) => {
        const e = bot.nearestEntity(filter);
        if (!e) return null;
        return { position: e.position, name: e.name, type: e.type, username: (e as any).username };
      },
      get players() {
        const result: Record<string, { entity: { position: Vec3 } | null; username: string }> = {};
        for (const [name, p] of Object.entries(bot.players)) {
          result[name] = { username: p.username, entity: p.entity ? { position: p.entity.position } : null };
        }
        return result;
      },
      craft: async (recipe: any, count: number, table?: any) => {
        await bot.craft(recipe, count, table);
      },
      recipesFor: (itemId: number, metadata?: number | null, minResultCount?: number | null, craftingTable?: any) =>
        bot.recipesFor(itemId, metadata ?? null, minResultCount ?? null, craftingTable ?? null),
      equip: async (item: any, dest: string) => {
        await bot.equip(item, dest as any);
      },
      once: (event: string, listener: (...args: any[]) => void) => {
        const allowed = ['goal_reached', 'diggingCompleted', 'death', 'health'];
        if (allowed.includes(event)) bot.once(event as any, listener);
      },
      on: (event: string, listener: (...args: any[]) => void) => {
        const allowed = ['goal_reached', 'diggingCompleted', 'death', 'health'];
        if (allowed.includes(event)) bot.on(event as any, listener);
      },
      removeListener: (event: string, listener: (...args: any[]) => void) => {
        bot.removeListener(event as any, listener);
      },
      waitForTicks: (ticks: number) => interruptibleDelay(ticks * 50),
    };
  }
}
