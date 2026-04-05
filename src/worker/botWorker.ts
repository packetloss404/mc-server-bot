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
  onSwarmDirective: (description, requestedBy) => {
    ipc.notify('swarm.directive', { description, requestedBy });
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
    default:
      throw new Error(`Unknown request type in worker: ${type}`);
  }
});

// Push status to main thread periodically
const statusInterval = setInterval(() => {
  try {
    ipc.notify('status.update', {
      status: instance.getStatus(),
      detailedStatus: instance.getDetailedStatus(),
      diagnostics: instance.getDiagnosticsSummary(),
    });
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
