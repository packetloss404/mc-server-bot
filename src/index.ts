import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import v8 from 'v8';
import { loadConfig } from './config';
import { BotManager } from './bot/BotManager';
import { createAPIServer } from './server/api';
import { logger } from './util/logger';
import type { LLMClient } from './ai/LLMClient';
import { buildProviderClients } from './ai/ProviderRegistry';
import { ModelRouter } from './ai/ModelRouter';
import { TokenLedger } from './ai/TokenLedger';
import { LLMSettings } from './ai/LLMSettings';
import { registerLLMRoutes } from './server/llmRoutes';
import { setupSocketEvents } from './server/socketEvents';

function buildModelRouter(config: ReturnType<typeof loadConfig>): { client: LLMClient | null; ledger: TokenLedger } {
  const ledger = new TokenLedger();
  const clients = buildProviderClients(config);

  if (clients.size === 0) {
    return { client: null, ledger };
  }

  // If no routes configured, use single-provider mode (backward compatible)
  if (!config.llm.routes) {
    const defaultClient = clients.get(config.llm.provider) ?? clients.values().next().value;
    // Wrap in router anyway for token tracking
    const router = new ModelRouter(clients, { defaultProvider: config.llm.provider }, ledger);
    return { client: router, ledger };
  }

  const router = new ModelRouter(clients, {
    defaultProvider: config.llm.provider,
    routes: config.llm.routes,
  }, ledger);
  return { client: router, ledger };
}

async function main() {
  logger.info('Starting DyoBot sidecar...');

  const config = loadConfig();

  // LLMSettings is the source of truth for /settings UI and supports the full
  // provider lineup (gemini/anthropic/openai/minimax/voyage/ollama). Prefer
  // its router at boot so the routes the user configured in /settings actually
  // take effect — fall back to the legacy ProviderRegistry path only when
  // LLMSettings has no providers configured.
  const tokenLedger = new TokenLedger();
  const llmSettings = new LLMSettings(tokenLedger);
  let llmClient: LLMClient | null = llmSettings.buildRouter();
  if (llmClient) {
    const settings = llmSettings.getSettings();
    logger.info(
      { providers: settings.providers.map((p) => p.name), defaultProvider: settings.defaultProvider, routes: Object.keys(settings.routes) },
      'LLM ModelRouter initialized from LLMSettings',
    );
  } else {
    const fallback = buildModelRouter(config);
    llmClient = fallback.client;
    if (llmClient) {
      logger.info({ model: config.llm.model, routes: Object.keys(config.llm.routes ?? {}) }, 'LLM ModelRouter initialized from legacy ProviderRegistry');
    }
  }

  const botManager = new BotManager(config, llmClient);
  let memoryInterval: NodeJS.Timeout | null = null;
  const snapshotDir = path.join(process.cwd(), 'diagnostics', 'heapsnapshots');
  const snapshotThresholdsMb = [512, 1024, 2048, 3072];
  const writtenSnapshotThresholds = new Set<number>();

  // Restore previously saved bots
  await botManager.loadSavedBots();

  // Start HTTP API server with Socket.IO
  const { app, httpServer, io, eventLog, buildCoordinator, campaignManager, chainCoordinator } = createAPIServer(botManager);

  // Register LLM settings/usage API routes (llmSettings + tokenLedger built above)
  registerLLMRoutes(app, llmSettings, tokenLedger, botManager);

  // Set up real-time Socket.IO event broadcasting
  setupSocketEvents(botManager, io, eventLog);

  // Decay hostility over time — every 60s, nudge affinities 1 point toward default
  setInterval(() => {
    botManager.getAffinityManager().decayTowardDefault();
  }, 60000);

  // DungeonMaster: evaluate world state and generate events every 60s
  setInterval(() => {
    try {
      const workers = botManager.getAllWorkers();
      if (workers.length === 0) return;
      const statuses = workers.map((w) => w.getCachedDetailedStatus()).filter(Boolean);
      const snapshot = {
        botCount: workers.length,
        playerCount: 0, // TODO: track via player-join/leave events
        serverTimeOfDay: statuses[0]?.world?.timeOfDay ?? 0,
        weather: statuses[0]?.world?.isRaining ? 'rain' : 'clear',
        totalResources: {},
        recentCompletedTasks: statuses.reduce((sum: number, s: any) => sum + (s?.voyager?.completedTasks?.length ?? 0), 0),
        exploredChunkCount: 0,
        activeThreatCount: 0,
        averageBotHealth: statuses.reduce((sum: number, s: any) => sum + (s?.health ?? 20), 0) / Math.max(1, statuses.length),
      };
      const event = botManager.getDungeonMaster().evaluateAndGenerate(snapshot);
      if (event) {
        for (const task of event.tasks) {
          botManager.getBlackboardManager().addTask(
            { description: task.description, keywords: task.keywords },
            'swarm',
            undefined,
            task.priority as any,
          );
        }
        const ev = eventLog.push({ type: 'world:event', botName: 'DungeonMaster', description: event.title });
        io.emit('world:event', event);
        io.emit('activity', ev);
        logger.info({ eventId: event.id, title: event.title }, 'DungeonMaster generated world event');
      }
      botManager.getDungeonMaster().expireOldEvents();
    } catch (err: any) {
      logger.error({ err: err.message }, 'DungeonMaster tick failed');
    }
  }, 60000);

  const formatMb = (bytes: number) => Number((bytes / 1024 / 1024).toFixed(1));
  const captureHeapSnapshot = (thresholdMb: number, heapUsedMb: number) => {
    try {
      if (!fs.existsSync(snapshotDir)) {
        fs.mkdirSync(snapshotDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[.:]/g, '-');
      const filePath = path.join(snapshotDir, `heap-${thresholdMb}mb-${timestamp}.heapsnapshot`);
      const writtenPath = v8.writeHeapSnapshot(filePath);
      logger.warn({ thresholdMb, heapUsedMb, filePath: writtenPath }, 'Heap snapshot captured');
    } catch (err: any) {
      logger.error({ thresholdMb, heapUsedMb, err: err?.message || String(err) }, 'Failed to capture heap snapshot');
    }
  };

  const startMemoryDiagnostics = () => {
    memoryInterval = setInterval(() => {
      const memory = process.memoryUsage();
      const heap = v8.getHeapStatistics();
      const diagnostics = botManager.getDiagnosticsSnapshot();
      const heapUsedMb = formatMb(memory.heapUsed);

      logger.info({
        rssMb: formatMb(memory.rss),
        heapUsedMb,
        heapTotalMb: formatMb(memory.heapTotal),
        externalMb: formatMb(memory.external),
        arrayBuffersMb: formatMb(memory.arrayBuffers),
        heapLimitMb: formatMb(heap.heap_size_limit),
        totalHeapMb: formatMb(heap.total_heap_size),
        usedHeapMb: formatMb(heap.used_heap_size),
        totalBots: diagnostics.totalBots,
        bots: diagnostics.bots.map((bot: any) => ({
          name: bot.name,
          state: bot.state,
          health: typeof bot.health === 'number' ? Number(bot.health.toFixed(2)) : 0,
          food: bot.food ?? 0,
          position: bot.position,
          currentTask: bot.voyager?.currentTask ?? null,
          queuedTasks: bot.voyager?.queuedTasks ?? 0,
          voyagerPaused: bot.voyager?.isPaused ?? false,
          lastExecution: bot.voyager?.lastExecution
            ? {
                task: bot.voyager.lastExecution.task,
                attempt: bot.voyager.lastExecution.attempt,
                success: bot.voyager.lastExecution.success,
                outputLength: bot.voyager.lastExecution.outputLength,
                eventCount: bot.voyager.lastExecution.eventCount,
                eventLogLength: bot.voyager.lastExecution.eventLogLength,
                codeLength: bot.voyager.lastExecution.codeLength,
                ageSec: Number(((Date.now() - bot.voyager.lastExecution.timestamp) / 1000).toFixed(1)),
              }
            : null,
        })),
      }, 'Memory diagnostics');

      for (const thresholdMb of snapshotThresholdsMb) {
        if (heapUsedMb >= thresholdMb && !writtenSnapshotThresholds.has(thresholdMb)) {
          writtenSnapshotThresholds.add(thresholdMb);
          logger.warn({ thresholdMb, heapUsedMb }, 'Heap threshold exceeded');
          captureHeapSnapshot(thresholdMb, heapUsedMb);
        }
      }
    }, 10000);
  };

  startMemoryDiagnostics();

  httpServer.listen(config.api.port, config.api.host, () => {
    logger.info({ port: config.api.port, host: config.api.host }, 'DyoBot API server running (HTTP + WebSocket)');
  });

  // Resume any persisted in-progress builds, after workers have had time to connect.
  setTimeout(() => {
    buildCoordinator.resumePendingJobs().catch((err) => {
      logger.error({ err: err.message }, 'Failed to resume pending build jobs');
    });
    campaignManager.resumePendingCampaigns().catch((err) => {
      logger.error({ err: err.message }, 'Failed to resume pending campaigns');
    });
  }, 20000);

  // Graceful shutdown — flush ALL managers before exiting
  const shutdown = async () => {
    logger.info('Shutting down DyoBot...');
    if (memoryInterval) {
      clearInterval(memoryInterval);
      memoryInterval = null;
    }

    // Flush token ledger and event log
    tokenLedger.shutdown();
    eventLog.shutdown();

    // Flush supply chain coordinator (stops polling + saves)
    chainCoordinator.shutdown();

    // Flush campaign manager (persists state)
    campaignManager.shutdown();

    // Flush persistence managers on BotManager (affinityManager, socialMemory, blackboardManager)
    // shutdownPersistence() is the canonical method when available; fall back to individual shutdown() calls
    if (typeof (botManager as any).shutdownPersistence === 'function') {
      (botManager as any).shutdownPersistence();
    } else {
      // Call shutdown() on individual managers if they have it (debounced-save pattern)
      const mgrs: any[] = [
        botManager.getAffinityManager(),
        botManager.getBlackboardManager(),
      ];
      for (const mgr of mgrs) {
        if (mgr && typeof mgr.shutdown === 'function') {
          try { mgr.shutdown(); } catch {}
        }
      }
    }

    // Close socket connections
    io.close();

    // Disconnect and remove all bots (also saves bots.json)
    await botManager.removeAllBots();

    logger.info('DyoBot shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start DyoBot');
  process.exit(1);
});
