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

      // Inventory — items are already in slot order, so no need to re-sort each tick.
      if (detailed?.inventory) {
        let invKey = '';
        for (const i of detailed.inventory) invKey += `${i.name}:${i.count},`;
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

  // Wire decision trace listeners on new workers — event-driven, no polling.
  // Also wire any bots that were spawned before this listener registered.
  const wireBot = (handle: {
    botName: string;
    setTraceListener: (cb: (r: any) => void) => void;
    setReputationListener: (cb: (e: any) => void) => void;
    setDeathListener?: (cb: (e: { botName: string; position: { x: number; y: number; z: number } | null }) => void) => void;
  }) => {
    handle.setTraceListener((record) => {
      io.emit('bot:decision', record);
    });
    handle.setReputationListener((event) => {
      botManager.getBotReputation().recordEvent(event);
    });
    handle.setDeathListener?.((event) => {
      const posText = event.position
        ? ` at ${event.position.x}, ${event.position.y}, ${event.position.z}`
        : '';
      const logEntry = eventLog.push({
        type: 'bot:died',
        botName: event.botName,
        description: `${event.botName} died${posText}`,
        metadata: { position: event.position },
      });
      io.emit('bot:died', { bot: event.botName, position: event.position });
      io.emit('activity', logEntry);
    });
  };
  for (const handle of botManager.getAllWorkers()) wireBot(handle);
  botManager.onBotSpawned(wireBot);

  // Clean up tracked state when bots are removed
  setInterval(() => {
    const activeNames = new Set(botManager.getAllWorkers().map((w) => w.botName));
    for (const name of prevPositions.keys()) {
      if (!activeNames.has(name)) {
        prevPositions.delete(name);
        prevHealth.delete(name);
        prevStates.delete(name);
        prevInventory.delete(name);
      }
    }
  }, 60000);

  logger.info('Socket.IO event broadcasting initialized (10s polling)');
}
