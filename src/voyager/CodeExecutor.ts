import vm from 'vm';
import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { mineBlock } from '../actions/mineBlock';
import { craft } from '../actions/craft';
import { placeBlock } from '../actions/placeBlock';
import { attack } from '../actions/attack';
import { smelt } from '../actions/smelt';
import { depositToContainer, inspectContainer, withdrawFromContainer } from '../actions/container';

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
  events: ExecutionEvent[];
}

export interface ExecutionEvent {
  type: string;
  message: string;
  data?: Record<string, unknown>;
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
  private static MAX_LOG_LINES = 250;
  private static MAX_LOG_CHARS = 24000;
  private static MAX_EVENTS = 80;
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
    const events: ExecutionEvent[] = [];
    let logChars = 0;
    let droppedLogLines = 0;
    let droppedEvents = 0;
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

    const pushLog = (line: string) => {
      if (logs.length >= CodeExecutor.MAX_LOG_LINES || logChars + line.length > CodeExecutor.MAX_LOG_CHARS) {
        droppedLogLines += 1;
        return;
      }
      logs.push(line);
      logChars += line.length + 1;
    };

    const pushPos = (label: string) => {
      const pos = bot.entity.position;
      pushLog(`${label} pos=(${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) moving=${bot.pathfinder.isMoving()}`);
    };

    const pushEvent = (type: string, message: string, data?: Record<string, unknown>) => {
      if (events.length >= CodeExecutor.MAX_EVENTS) {
        droppedEvents += 1;
        return;
      }
      events.push({ type, message, data });
    };

    const addMovementTrace = (label: string) => {
      const onGoalReached = () => {
        const pos = bot.entity.position;
        pushLog(`[trace:${label}] goal_reached at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
      };
      const onPathReset = (reason?: string) => pushLog(`[trace:${label}] path_reset reason=${String(reason || 'unknown')}`);
      const onPathStop = () => pushLog(`[trace:${label}] path_stop`);
      const onDeath = () => pushLog(`[trace:${label}] death while primitive running`);
      const onSpawn = () => {
        const pos = bot.entity.position;
        pushLog(`[trace:${label}] spawn at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
      };
      const onPathUpdate = (result: any) => {
        const status = result?.status || 'unknown';
        const nodes = Array.isArray(result?.path) ? result.path.length : 0;
        pushLog(`[trace:${label}] path_update status=${status} nodes=${nodes}`);
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

    const botProxy = this.createBotProxy(bot, pushLog, interruptibleDelay);

    const sandbox = {
      bot: botProxy,
      Vec3,
      goals,
      console: {
          log: (...args: any[]) => pushLog(args.map(String).join(' ')),
          error: (...args: any[]) => pushLog('[ERROR] ' + args.map(String).join(' ')),
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
        pushLog(`[primitive] mineBlock("${name}", ${count})`);
        pushEvent('primitive_start', `mineBlock ${name} x${count}`, { primitive: 'mineBlock', name, count });
        const result = await mineBlock(bot, name, count);
        const message = result.message || 'mineBlock completed';
        pushLog(`[primitive] mineBlock result: ${message}`);
        pushEvent(result.success ? 'primitive_success' : 'primitive_failure', message, { primitive: 'mineBlock', name, count });
        const afterItems = bot.inventory.items().map((i) => `${i.name}x${i.count}`).join(', ') || 'empty';
        pushLog(`[primitive] mineBlock inventory before=${beforeItems} after=${afterItems}`);
        return result;
      },
      craftItem: async (name: string, count = 1) => {
        throwIfInterrupted();
        pushLog(`[primitive] craftItem("${name}", ${count})`);
        pushEvent('primitive_start', `craftItem ${name} x${count}`, { primitive: 'craftItem', name, count });
        const result = await craft(bot, name, count);
        const message = result.message || 'craftItem completed';
        pushLog(`[primitive] craftItem result: ${message}`);
        pushEvent(result.success ? 'primitive_success' : 'primitive_failure', message, { primitive: 'craftItem', name, count });
        return result;
      },
      smeltItem: async (itemName: string, fuelName: string, count = 1) => {
        throwIfInterrupted();
        pushLog(`[primitive] smeltItem("${itemName}", "${fuelName}", ${count})`);
        pushEvent('primitive_start', `smeltItem ${itemName} fuel=${fuelName} x${count}`, { primitive: 'smeltItem', itemName, fuelName, count });
        const result = await smelt(bot, itemName, fuelName, count);
        const message = result.message || 'smeltItem completed';
        pushLog(`[primitive] smeltItem result: ${message}`);
        pushEvent(result.success ? 'primitive_success' : 'primitive_failure', message, { primitive: 'smeltItem', itemName, fuelName, count });
        return result;
      },
      placeItem: async (name: string, x: number, y: number, z: number) => {
        throwIfInterrupted();
        pushLog(`[primitive] placeItem("${name}", ${x}, ${y}, ${z})`);
        pushEvent('primitive_start', `placeItem ${name}`, { primitive: 'placeItem', name, x, y, z });
        const result = await placeBlock(bot, name, x, y, z);
        const message = result.message || 'placeItem completed';
        pushLog(`[primitive] placeItem result: ${message}`);
        pushEvent(result.success ? 'primitive_success' : 'primitive_failure', message, { primitive: 'placeItem', name, x, y, z });
        return result;
      },
      withdrawItem: async (containerName: string, itemName: string, count = 1) => {
        throwIfInterrupted();
        pushLog(`[primitive] withdrawItem("${containerName}", "${itemName}", ${count})`);
        pushEvent('primitive_start', `withdrawItem ${itemName} from ${containerName}`, { primitive: 'withdrawItem', containerName, itemName, count });
        const result = await withdrawFromContainer(bot, containerName, itemName, count);
        const message = result.message || 'withdrawItem completed';
        pushLog(`[primitive] withdrawItem result: ${message}`);
        pushEvent(result.success ? 'primitive_success' : 'primitive_failure', message, { primitive: 'withdrawItem', containerName, itemName, count });
        return result;
      },
      depositItem: async (containerName: string, itemName: string, count = 1) => {
        throwIfInterrupted();
        pushLog(`[primitive] depositItem("${containerName}", "${itemName}", ${count})`);
        pushEvent('primitive_start', `depositItem ${itemName} into ${containerName}`, { primitive: 'depositItem', containerName, itemName, count });
        const result = await depositToContainer(bot, containerName, itemName, count);
        const message = result.message || 'depositItem completed';
        pushLog(`[primitive] depositItem result: ${message}`);
        pushEvent(result.success ? 'primitive_success' : 'primitive_failure', message, { primitive: 'depositItem', containerName, itemName, count });
        return result;
      },
      inspectContainer: async (containerName: string) => {
        throwIfInterrupted();
        pushLog(`[primitive] inspectContainer("${containerName}")`);
        pushEvent('primitive_start', `inspectContainer ${containerName}`, { primitive: 'inspectContainer', containerName });
        const result = await inspectContainer(bot, containerName);
        const message = result.message || 'inspectContainer completed';
        pushLog(`[primitive] inspectContainer result: ${message}`);
        pushEvent(result.success ? 'primitive_success' : 'primitive_failure', message, { primitive: 'inspectContainer', containerName });
        return result;
      },
      setBlock: async (name: string, x: number, y: number, z: number, state?: string) => {
        const blockSpec = state ? `minecraft:${name}[${state}]` : `minecraft:${name}`;
        bot.chat(`/setblock ${Math.floor(x)} ${Math.floor(y)} ${Math.floor(z)} ${blockSpec} replace`);
        pushLog(`[primitive] setBlock("${blockSpec}", ${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)})`);
        await new Promise((r) => setTimeout(r, 50));
      },
      fillBlocks: async (name: string, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, mode = 'replace') => {
        const blockSpec = `minecraft:${name}`;
        bot.chat(`/fill ${Math.floor(x1)} ${Math.floor(y1)} ${Math.floor(z1)} ${Math.floor(x2)} ${Math.floor(y2)} ${Math.floor(z2)} ${blockSpec} ${mode}`);
        pushLog(`[primitive] fillBlocks("${name}", ${x1},${y1},${z1} -> ${x2},${y2},${z2}, ${mode})`);
        await new Promise((r) => setTimeout(r, 100));
      },
      killMob: async (name: string, maxDuration = 30000) => {
        throwIfInterrupted();
        pushLog(`[primitive] killMob("${name}")`);
        pushEvent('primitive_start', `killMob ${name}`, { primitive: 'killMob', name, maxDuration });
        const result = await attack(bot, name, maxDuration);
        const message = result.message || 'killMob completed';
        pushLog(`[primitive] killMob result: ${message}`);
        pushEvent(result.success ? 'primitive_success' : 'primitive_failure', message, { primitive: 'killMob', name, maxDuration });
        return result;
      },
      moveTo: async (x: number, y: number, z: number, range = 2, timeoutSec = 15) => {
        throwIfInterrupted();
        const cleanupTrace = addMovementTrace('moveTo');
        const start = bot.entity.position;
        const targetSummary = `(${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)})`;
        pushLog(`[primitive] moveTo target=${targetSummary} range=${range} timeoutSec=${timeoutSec}`);
        pushEvent('primitive_start', `moveTo ${targetSummary}`, { primitive: 'moveTo', x, y, z, range, timeoutSec });
        pushLog(`[primitive] moveTo startPos=(${start.x.toFixed(1)}, ${start.y.toFixed(1)}, ${start.z.toFixed(1)})`);
        bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, range));
        return new Promise<boolean>((resolve, reject) => {
          const timeout = setTimeout(() => {
            bot.pathfinder.stop();
            const pos = bot.entity.position;
            pushLog(`[primitive] moveTo: timed out, stopping at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
            pushEvent('primitive_failure', 'moveTo timed out', { primitive: 'moveTo', x, y, z, range, timeoutSec });
            cleanupTrace();
            cleanupInterrupt();
            resolve(false);
          }, timeoutSec * 1000);
          const cleanupInterrupt = onInterrupt((reason) => {
            clearTimeout(timeout);
            bot.pathfinder.stop();
            pushLog(`[primitive] moveTo: interrupted (${reason})`);
            pushEvent('interrupt', `moveTo interrupted: ${reason}`, { primitive: 'moveTo', reason });
            cleanupTrace();
            cleanupInterrupt();
            reject(new Error(`Execution interrupted: ${reason}`));
          });
          bot.once('goal_reached' as any, () => {
            clearTimeout(timeout);
            const pos = bot.entity.position;
            pushLog(`[primitive] moveTo: goal reached at (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)})`);
            pushEvent('primitive_success', 'moveTo reached goal', { primitive: 'moveTo', x, y, z, range, timeoutSec });
            cleanupTrace();
            cleanupInterrupt();
            resolve(true);
          });
        });
      },
      exploreUntil: async (direction: { x: number; y: number; z: number }, maxTime = 60, callback: () => any) => {
        throwIfInterrupted();
        const cleanupTrace = addMovementTrace('exploreUntil');
        pushLog(`[primitive] exploreUntil(${JSON.stringify(direction)}, ${maxTime}s)`);
        pushEvent('primitive_start', 'exploreUntil started', { primitive: 'exploreUntil', direction, maxTime });
        if (!direction || typeof direction.x !== 'number' || typeof direction.y !== 'number' || typeof direction.z !== 'number') {
          pushLog(`[primitive] exploreUntil: invalid direction argument ${JSON.stringify(direction)}`);
          pushEvent('primitive_failure', 'exploreUntil invalid direction', { primitive: 'exploreUntil', direction });
          cleanupTrace();
          throw new Error('exploreUntil requires direction { x, y, z }');
        }
        const validAxis = [direction.x, direction.y, direction.z].every((value) => value === -1 || value === 0 || value === 1);
        if (!validAxis || (direction.x === 0 && direction.y === 0 && direction.z === 0)) {
          pushLog(`[primitive] exploreUntil: invalid discrete direction ${JSON.stringify(direction)}`);
          pushEvent('primitive_failure', 'exploreUntil invalid discrete direction', { primitive: 'exploreUntil', direction });
          cleanupTrace();
          throw new Error('exploreUntil direction must use only -1, 0, or 1 and cannot be 0,0,0');
        }
        const startTime = Date.now();
        const dir = new Vec3(direction.x, direction.y, direction.z);
        return await new Promise<any>((resolve, reject) => {
          let iteration = 0;
          const cleanUp = () => {
            clearInterval(explorationInterval);
            clearTimeout(maxTimeTimeout);
            bot.pathfinder.setGoal(null as any);
            cleanupTrace();
            cleanupInterrupt();
          };

          const cleanupInterrupt = onInterrupt((reason) => {
            pushLog(`[primitive] exploreUntil: interrupted (${reason})`);
            pushEvent('interrupt', `exploreUntil interrupted: ${reason}`, { primitive: 'exploreUntil', reason });
            cleanUp();
            reject(new Error(`Execution interrupted: ${reason}`));
          });

          const explore = () => {
            try {
              throwIfInterrupted();
              iteration++;
              const found = callback();
              if (found) {
                const blockPos = (found as any)?.position;
                pushLog(`[primitive] exploreUntil: found target on iteration=${iteration}${blockPos ? ` at (${blockPos.x}, ${blockPos.y}, ${blockPos.z})` : ''}`);
                pushEvent('primitive_success', 'exploreUntil found target', { primitive: 'exploreUntil', iteration, blockPos });
                cleanUp();
                resolve(found);
                return;
              }

              const stepX = dir.x === 0 ? 0 : (Math.floor(Math.random() * 20) + 10) * dir.x;
              const stepY = dir.y === 0 ? 0 : (Math.floor(Math.random() * 20) + 10) * dir.y;
              const stepZ = dir.z === 0 ? 0 : (Math.floor(Math.random() * 20) + 10) * dir.z;
              const pos = bot.entity.position;
              const target = pos.offset(stepX, stepY, stepZ);
              pushLog(`[primitive] exploreUntil: iteration=${iteration} moving from (${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}) toward (${target.x.toFixed(1)}, ${target.y.toFixed(1)}, ${target.z.toFixed(1)})`);

              if (dir.y === 0) {
                bot.pathfinder.setGoal(new goals.GoalNearXZ(target.x, target.z, 3) as any);
              } else {
                bot.pathfinder.setGoal(new goals.GoalNear(target.x, target.y, target.z, 3));
              }
            } catch (err: any) {
              cleanUp();
              reject(err);
            }
          };

          const explorationInterval = setInterval(explore, 2000);
          const maxTimeTimeout = setTimeout(() => {
            pushLog('[primitive] exploreUntil: timed out');
            pushEvent('primitive_failure', 'exploreUntil timed out', { primitive: 'exploreUntil', maxTime });
            cleanUp();
            resolve(null);
          }, Math.min(maxTime, 1200) * 1000);

          explore();
        });
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

    let timeoutHandle: NodeJS.Timeout | null = null;
    const cleanup = { interrupt: null as (Function | null) };

    try {
      const context = vm.createContext(sandbox);
      const script = new vm.Script(wrappedCode, { filename: 'skill.js' });
      const resultPromise = script.runInContext(context, { timeout: 5000 });

      await Promise.race([
        resultPromise,
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(() => reject(new Error('Execution timed out')), this.timeoutMs);
        }),
        new Promise((_, reject) => {
          cleanup.interrupt = onInterrupt((reason) => {
            if (cleanup.interrupt) cleanup.interrupt();
            reject(new Error(`Execution interrupted: ${reason}`));
          });
        }),
      ]);

      if (droppedLogLines > 0) {
        logs.push(`[exec] truncated ${droppedLogLines} log lines`);
      }
      if (droppedEvents > 0) {
        events.push({ type: 'trace_truncated', message: `Dropped ${droppedEvents} execution events`, data: { droppedEvents } });
      }
      pushPos('[exec] end');
      pushLog(`[exec] movedDistance=${startPos.distanceTo(bot.entity.position).toFixed(2)}`);
      pushEvent('execution_complete', 'Execution completed', { movedDistance: Number(startPos.distanceTo(bot.entity.position).toFixed(2)) });
      return { success: true, output: logs.join('\n'), events };
    } catch (err: any) {
      if (droppedLogLines > 0) {
        logs.push(`[exec] truncated ${droppedLogLines} log lines`);
      }
      if (droppedEvents > 0) {
        events.push({ type: 'trace_truncated', message: `Dropped ${droppedEvents} execution events`, data: { droppedEvents } });
      }
      pushPos('[exec] error');
      pushLog(`[exec] movedDistance=${startPos.distanceTo(bot.entity.position).toFixed(2)}`);
      pushEvent('execution_error', err.message || String(err), { movedDistance: Number(startPos.distanceTo(bot.entity.position).toFixed(2)) });
      return {
        success: false,
        output: logs.join('\n'),
        error: err.message || String(err),
        events,
      };
    } finally {
      // Clean up timeout and interrupt listener to prevent retained references
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (cleanup.interrupt) cleanup.interrupt();
      interruptState.listeners.clear();
      if (this.currentInterrupt === interruptState) {
        this.currentInterrupt = null;
      }
      // Clear logs array to release strings
      logs.length = 0;
    }
  }

  private createBotProxy(bot: Bot, pushLog: (line: string) => void, interruptibleDelay: (ms: number) => Promise<void>) {
    return {
      get entity() { return { position: bot.entity.position, velocity: bot.entity.velocity, height: (bot.entity as any).height || 1.8 }; },
      get health() { return bot.health; },
      get food() { return bot.food; },
      get time() { return { timeOfDay: bot.time.timeOfDay, day: bot.time.day }; },
      get isRaining() { return bot.isRaining; },
      get inventory() {
        return {
          items: () => bot.inventory.items().map((i) => ({ name: i.name, count: i.count, slot: i.slot, type: i.type })),
        };
      },
      chat: (msg: string) => {
        const safe = String(msg).slice(0, 256);
        if (!safe.startsWith('/')) pushLog(`[chat] ${safe}`);
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
      toss: async (itemType: number, metadata: any, count: number) => {
        await bot.toss(itemType, metadata, count);
      },
    };
  }
}
