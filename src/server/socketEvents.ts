import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { BotInstance } from '../bot/BotInstance';
import { EventLog } from './EventLog';
import { logger } from '../util/logger';

/**
 * Sets up real-time event broadcasting from bot instances to connected dashboard clients.
 *
 * Primary: event-driven updates emitted directly from BotInstance via EventEmitter.
 * Fallback: polling loop every 10 seconds catches any missed changes.
 */
export function setupSocketEvents(
  botManager: BotManager,
  io: SocketIOServer,
  eventLog: EventLog
): void {
  // Track previous state to detect changes (used by both event-driven and fallback polling)
  const prevPositions = new Map<string, string>();
  const prevHealth = new Map<string, string>();
  const prevStates = new Map<string, string>();
  const prevInventory = new Map<string, string>();

  // Track which bots we've attached event listeners to
  const subscribedBots = new Set<string>();

  /**
   * Subscribe to event-driven updates from a BotInstance.
   * Forwards BotInstance EventEmitter events to Socket.IO.
   */
  function subscribeToBotEvents(bot: BotInstance): void {
    if (subscribedBots.has(bot.name)) return;
    subscribedBots.add(bot.name);

    bot.on('positionChanged', (data: { bot: string; x: number; y: number; z: number }) => {
      const posKey = `${data.x},${data.y},${data.z}`;
      if (prevPositions.get(data.bot) !== posKey) {
        prevPositions.set(data.bot, posKey);
        io.emit('bot:position', data);
      }
    });

    bot.on('healthChanged', (data: { bot: string; health: number; food: number }) => {
      const healthKey = `${data.health}:${data.food}`;
      if (prevHealth.get(data.bot) !== healthKey) {
        prevHealth.set(data.bot, healthKey);
        io.emit('bot:health', data);
      }
    });

    bot.on('stateChanged', (data: { bot: string; state: string; previousState: string }) => {
      if (prevStates.get(data.bot) !== data.state) {
        prevStates.set(data.bot, data.state);
        io.emit('bot:state', data);

        eventLog.push({
          type: 'bot:state',
          botName: data.bot,
          description: `${data.bot} state: ${data.previousState ?? '?'} → ${data.state}`,
          metadata: { from: data.previousState, to: data.state },
        });
      }
    });

    bot.on('inventoryChanged', (data: { bot: string; items: Array<{ name: string; count: number; slot: number }> }) => {
      const invKey = data.items.map((i) => `${i.name}:${i.count}`).sort().join(',');
      if (prevInventory.get(data.bot) !== invKey) {
        prevInventory.set(data.bot, invKey);
        io.emit('bot:inventory', data);
      }
    });

    // Player join/leave events
    if (bot.bot) {
      bot.bot.on('playerJoined', (player: any) => {
        if (player.username) io.emit('player:join', { name: player.username });
      });
      bot.bot.on('playerLeft', (player: any) => {
        if (player.username) io.emit('player:leave', { name: player.username });
      });
    }

    logger.debug({ bot: bot.name }, 'Subscribed to event-driven socket updates');
  }

  // Subscribe to all currently existing bots and check for new ones periodically
  function subscribeAllBots(): void {
    for (const bot of botManager.getAllBots()) {
      subscribeToBotEvents(bot);
    }
  }

  // Initial subscription
  subscribeAllBots();

  // Check for new bots every 5 seconds and subscribe them
  setInterval(subscribeAllBots, 5000);

  // Fallback polling every 10 seconds — safety net in case events are missed
  setInterval(() => {
    const bots = botManager.getAllBots();
    for (const bot of bots) {
      if (!bot.bot) continue;
      const name = bot.name;

      // Position
      try {
        const pos = bot.bot.entity?.position;
        if (pos) {
          const posKey = `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}`;
          if (prevPositions.get(name) !== posKey) {
            prevPositions.set(name, posKey);
            io.emit('bot:position', {
              bot: name,
              x: Math.round(pos.x),
              y: Math.round(pos.y),
              z: Math.round(pos.z),
            });
          }
        }
      } catch { /* bot may be disconnected */ }

      // Health & food
      try {
        const healthKey = `${bot.bot.health}:${bot.bot.food}`;
        if (prevHealth.get(name) !== healthKey) {
          prevHealth.set(name, healthKey);
          io.emit('bot:health', {
            bot: name,
            health: bot.bot.health,
            food: bot.bot.food,
          });
        }
      } catch { /* ignore */ }

      // State
      const stateKey = bot.state;
      if (prevStates.get(name) !== stateKey) {
        const previousState = prevStates.get(name);
        prevStates.set(name, stateKey);
        io.emit('bot:state', {
          bot: name,
          state: stateKey,
          previousState: previousState ?? null,
        });

        eventLog.push({
          type: 'bot:state',
          botName: name,
          description: `${name} state: ${previousState ?? '?'} → ${stateKey}`,
          metadata: { from: previousState, to: stateKey },
        });
      }

      // Inventory (check by stringified hash — only emit on actual change)
      try {
        const items = bot.bot.inventory.items();
        const invKey = items.map((i) => `${i.name}:${i.count}`).sort().join(',');
        if (prevInventory.get(name) !== invKey) {
          prevInventory.set(name, invKey);
          io.emit('bot:inventory', {
            bot: name,
            items: items.map((i) => ({ name: i.name, count: i.count, slot: i.slot })),
          });
        }
      } catch { /* ignore */ }

      // Player positions (only for players with entities in range)
      try {
        for (const p of Object.values(bot.bot.players) as any[]) {
          if (p.username && p.entity) {
            io.emit('player:position', {
              name: p.username,
              x: Math.round(p.entity.position.x),
              y: Math.round(p.entity.position.y),
              z: Math.round(p.entity.position.z),
            });
          }
        }
      } catch { /* ignore */ }
    }
  }, 10000);

  // World time broadcast every 30 seconds
  setInterval(() => {
    const bots = botManager.getAllBots();
    const connected = bots.find((b) => b.bot);
    if (!connected?.bot) return;

    const bot = connected.bot;
    const timeOfDay = bot.time.timeOfDay < 6000 ? 'sunrise'
      : bot.time.timeOfDay < 12000 ? 'day'
      : bot.time.timeOfDay < 18000 ? 'sunset'
      : 'night';

    io.emit('world:time', {
      timeOfDay,
      timeOfDayTicks: bot.time.timeOfDay,
      day: bot.time.day,
      isRaining: bot.isRaining,
    });
  }, 30000);

  // Clean up tracked state when bots disconnect
  setInterval(() => {
    const activeNames = new Set(botManager.getAllBots().map((b) => b.name));
    for (const name of prevPositions.keys()) {
      if (!activeNames.has(name)) {
        prevPositions.delete(name);
        prevHealth.delete(name);
        prevStates.delete(name);
        prevInventory.delete(name);
        subscribedBots.delete(name);
      }
    }
  }, 60000);

  logger.info('Socket.IO event broadcasting initialized (event-driven + 10s fallback polling)');
}
