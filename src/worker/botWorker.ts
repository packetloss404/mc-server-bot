import 'dotenv/config';
import { workerData, parentPort } from 'worker_threads';
import { loadConfig } from '../config';
import { BotInstance } from '../bot/BotInstance';
import { BotMode } from '../bot/BotState';
import { IPCChannel } from './IPCChannel';
import { LLMClientProxy } from './proxies/LLMClientProxy';
import { BlackboardProxy } from './proxies/BlackboardProxy';
import { AffinityProxy } from './proxies/AffinityProxy';
import { ConversationProxy } from './proxies/ConversationProxy';
import { SharedWorldProxy } from './proxies/SharedWorldProxy';
import { logger } from '../util/logger';

interface WorkerData {
  botName: string;
  personality: string;
  mode: string;
  spawnLocation?: { x: number; y: number; z: number };
  configPath?: string;
}

const data = workerData as WorkerData;

if (!parentPort) {
  throw new Error('botWorker must be run as a worker thread');
}

const config = loadConfig(data.configPath);
const ipc = new IPCChannel(parentPort);

// Create proxy objects for shared managers
const llmProxy = new LLMClientProxy(ipc);
const blackboardProxy = new BlackboardProxy(ipc);
const affinityProxy = new AffinityProxy(ipc);
const conversationProxy = new ConversationProxy(ipc);
const sharedWorldProxy = new SharedWorldProxy(ipc);

const botMode = data.mode === 'codegen' ? BotMode.CODEGEN : BotMode.PRIMITIVE;

const instance = new BotInstance({
  name: data.botName,
  personality: data.personality,
  mode: botMode,
  spawnLocation: data.spawnLocation,
  config,
  llmClient: llmProxy,
  affinityManager: affinityProxy as any,
  conversationManager: conversationProxy as any,
  blackboardManager: blackboardProxy as any,
  sharedWorldModel: sharedWorldProxy as any,
  onSwarmDirective: (description, requestedBy) => {
    ipc.notify('swarm.directive', { description, requestedBy });
  },
  onReputationEvent: (event) => {
    ipc.notify('reputation.recordEvent', event);
  },
  onVoyagerLoopCreated: (loop) => {
    loop.getDecisionTrace().setEmitter((record) => {
      ipc.notify('decision.trace', record);
    });
    loop.getDecisionTrace().setReputationEmitter((event) => {
      ipc.notify('reputation.recordEvent', event);
    });
    logger.info({ bot: data.botName }, 'Decision trace + reputation notifier wired');
  },
});

// Handle commands from main thread
ipc.onCommand((type, cmdData) => {
  switch (type) {
    case 'disconnect':
      instance.disconnect().then(() => process.exit(0));
      break;
    case 'setMode':
      instance.setMode(cmdData.mode === 'codegen' ? BotMode.CODEGEN : BotMode.PRIMITIVE);
      break;
    case 'queueTask':
      if (cmdData.prepend) {
        instance.getVoyagerLoop()?.queuePlayerTaskFront(cmdData.description, cmdData.source || 'dashboard');
      } else {
        instance.getVoyagerLoop()?.queuePlayerTask(cmdData.description, cmdData.source || 'dashboard');
      }
      break;
    case 'reorderQueue':
      instance.getVoyagerLoop()?.reorderQueue(cmdData.order);
      break;
    case 'clearQueue':
      instance.getVoyagerLoop()?.clearQueue();
      break;
    case 'queueChat':
      if ((instance as any).bot?.emit) {
        (instance as any).bot.emit('chat', cmdData.playerName, cmdData.message);
      }
      break;
    case 'swarmDirective':
      instance.getVoyagerLoop()?.overrideWithSwarmDirective(cmdData.description, cmdData.requestedBy);
      break;
    case 'chat':
      try { (instance as any).bot?.chat(cmdData.message); } catch (err: any) {
        logger.warn({ bot: data.botName, err: err?.message }, 'chat command failed');
      }
      break;
    case 'setBotState':
      try { (instance as any).state = cmdData.state; } catch {}
      break;
    case 'pauseVoyager':
      instance.getVoyagerLoop()?.pause(cmdData.reason || 'external');
      break;
    case 'resumeVoyager':
      instance.getVoyagerLoop()?.resume();
      break;
    case 'stopMovement':
      try {
        (instance as any).bot?.pathfinder?.stop();
        (instance as any).bot?.clearControlStates();
      } catch {}
      break;
  }
});

// Handle requests from main thread (e.g., for detailed status on demand)
ipc.onRequest(async (type, args) => {
  switch (type) {
    case 'getStatus':
      return instance.getStatus();
    case 'getDetailedStatus':
      return instance.getDetailedStatus();
    case 'getDiagnosticsSummary':
      return instance.getDiagnosticsSummary();
    case 'getSkillNames': {
      const lib = instance.getVoyagerLoop()?.getSkillLibrary();
      return lib ? lib.getSkillNames() : [];
    }
    case 'getSkillCode': {
      const lib = instance.getVoyagerLoop()?.getSkillLibrary();
      return lib ? lib.getCode(args[0]) : null;
    }
    case 'getBotVersion':
      return (instance as any).bot?.version ?? null;
    case 'getBlockAt': {
      const bot = (instance as any).bot;
      if (!bot) return null;
      const { Vec3 } = require('vec3');
      const b = bot.blockAt(new Vec3(args[0], args[1], args[2]));
      return b ? { name: b.name } : null;
    }
    case 'isBotConnected':
      return !!(instance as any).bot?.entity;
    case 'getTerrainGrid': {
      // args: [cx, cz, radius, step, yTop, yBottom]
      const bot = (instance as any).bot;
      if (!bot) return null;
      const { Vec3 } = require('vec3');
      const [cx, cz, radius, step, yTop, yBottom] = args;
      const blocks: string[] = [];
      for (let dz = -radius; dz <= radius; dz += step) {
        for (let dx = -radius; dx <= radius; dx += step) {
          const wx = cx + dx, wz = cz + dz;
          let found = 'air';
          for (let y = yTop; y >= yBottom; y--) {
            const b = bot.blockAt(new Vec3(wx, y, wz));
            if (b && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') {
              found = b.name;
              break;
            }
          }
          blocks.push(found);
        }
      }
      return blocks;
    }
    case 'getPlayers': {
      const bot = (instance as any).bot;
      if (!bot?.players) return [];
      return Object.values(bot.players)
        .filter((p: any) => p && p.username && p.entity)
        .map((p: any) => ({
          name: p.username,
          position: {
            x: Math.floor(p.entity.position.x),
            y: Math.floor(p.entity.position.y),
            z: Math.floor(p.entity.position.z),
          },
          isOnline: true,
        }));
    }
    default:
      throw new Error(`Unknown request type in worker: ${type}`);
  }
});

// Push status to main thread periodically — diff-based to skip unchanged payloads.
// Force a heartbeat every 30s regardless so the main thread can detect a stale worker.
let lastStatusJson = '';
let lastStatusSentAt = 0;
const STATUS_HEARTBEAT_MS = 30_000;
const statusInterval = setInterval(() => {
  try {
    const payload = {
      status: instance.getStatus(),
      detailedStatus: instance.getDetailedStatus(),
      diagnostics: instance.getDiagnosticsSummary(),
    };
    const json = JSON.stringify(payload);
    const now = Date.now();
    if (json === lastStatusJson && now - lastStatusSentAt < STATUS_HEARTBEAT_MS) {
      return;
    }
    lastStatusJson = json;
    lastStatusSentAt = now;
    ipc.notify('status.update', payload);
  } catch {
    // Bot may not be fully initialized yet
  }
}, 2000);

// Connect the bot
logger.info({ bot: data.botName, worker: true }, 'Worker starting bot');
instance.connect().catch((err) => {
  logger.error({ bot: data.botName, err: err?.message }, 'Worker failed to connect bot');
});

// Cleanup on exit
process.on('beforeExit', () => {
  clearInterval(statusInterval);
});
