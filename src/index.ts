import 'dotenv/config';
import { loadConfig } from './config';
import { BotManager } from './bot/BotManager';
import { createAPIServer } from './server/api';
import { logger } from './util/logger';
import { GeminiClient } from './ai/GeminiClient';
import { LLMClient } from './ai/LLMClient';

async function main() {
  logger.info('Starting DyoBot sidecar...');

  const config = loadConfig();

  // Initialize LLM client (optional — bots work without it, just no chat AI)
  let llmClient: LLMClient | null = null;
  const apiKey = process.env.GOOGLE_API_KEY;
  if (apiKey) {
    llmClient = new GeminiClient({
      apiKey,
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.chatMaxTokens,
    });
    logger.info({ model: config.llm.model }, 'LLM client initialized');
  } else {
    logger.warn('GOOGLE_API_KEY not set — AI chat disabled');
  }

  const botManager = new BotManager(config, llmClient);

  // Restore previously saved bots
  await botManager.loadSavedBots();

  // Start HTTP API server
  const app = createAPIServer(botManager);
  app.listen(config.api.port, config.api.host, () => {
    logger.info({ port: config.api.port, host: config.api.host }, 'DyoBot API server running');
  });

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down DyoBot...');
    await botManager.removeAllBots();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start DyoBot');
  process.exit(1);
});
