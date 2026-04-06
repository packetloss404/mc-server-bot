import { Server as SocketIOServer } from 'socket.io';
import { BotManager } from '../bot/BotManager';
import { EventLog } from './EventLog';
import { logger } from '../util/logger';

/**
 * Sets up real-time event broadcasting from bot workers to connected dashboard clients.
 * Reads cached state from WorkerHandles and emits changes via Socket.IO.
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

  // Poll cached bot state every 2 seconds and emit changes
  setInterval(() => {
    const workers = botManager.getAllWorkers();
    for (const handle of workers) {
      const detailed = handle.getCachedDetailedStatus();
      const status = handle.getCachedStatus();
      if (!status) continue;
      const name = handle.botName;

      // Position
      const pos = status.position;
      if (pos) {
        const posKey = `${pos.x},${pos.y},${pos.z}`;
        if (prevPositions.get(name) !== posKey) {
          prevPositions.set(name, posKey);
          io.emit('bot:position', { bot: name, ...pos });
        }
      }

      // Health & food
      if (detailed) {
        const healthKey = `${detailed.health}:${detailed.food}`;
        if (prevHealth.get(name) !== healthKey) {
          prevHealth.set(name, healthKey);
          io.emit('bot:health', { bot: name, health: detailed.health, food: detailed.food });
        }
      }

      // State
      const stateKey = status.state;
      if (prevStates.get(name) !== stateKey) {
        const previousState = prevStates.get(name);
        prevStates.set(name, stateKey);
        io.emit('bot:state', { bot: name, state: stateKey, previousState: previousState ?? null });

        eventLog.push({
          type: 'bot:state',
          botName: name,
          description: `${name} state: ${previousState ?? '?'} → ${stateKey}`,
          metadata: { from: previousState, to: stateKey },
        });
      }

      // Inventory
      if (detailed?.inventory) {
        const invKey = detailed.inventory.map((i: any) => `${i.name}:${i.count}`).sort().join(',');
        if (prevInventory.get(name) !== invKey) {
          prevInventory.set(name, invKey);
          io.emit('bot:inventory', { bot: name, items: detailed.inventory });
        }
      }
    }
  }, 10000);

  // World time broadcast every 30 seconds
  setInterval(() => {
    const workers = botManager.getAllWorkers();
    for (const handle of workers) {
      const detailed = handle.getCachedDetailedStatus();
      if (detailed?.world) {
        io.emit('world:time', {
          timeOfDay: detailed.world.timeOfDay,
          isRaining: detailed.world.isRaining,
        });
        return;
      }
    }
  }, 30000);

  // Wire decision trace listeners on new workers (checked every 10s alongside state polling)
  const trackedBots = new Set<string>();
  setInterval(() => {
    for (const handle of botManager.getAllWorkers()) {
      if (!trackedBots.has(handle.botName)) {
        trackedBots.add(handle.botName);
        handle.setTraceListener((record) => {
          io.emit('bot:decision', record);
        });
        handle.setReputationListener((event) => {
          botManager.getBotReputation().recordEvent(event);
        });
      }
    }
  }, 10000);

  // Clean up tracked state when bots are removed
  setInterval(() => {
    const activeNames = new Set(botManager.getAllWorkers().map((w) => w.botName));
    for (const name of prevPositions.keys()) {
      if (!activeNames.has(name)) {
        prevPositions.delete(name);
        prevHealth.delete(name);
        prevStates.delete(name);
        prevInventory.delete(name);
        trackedBots.delete(name);
      }
    }
  }, 60000);

  logger.info('Socket.IO event broadcasting initialized (10s polling)');
}
