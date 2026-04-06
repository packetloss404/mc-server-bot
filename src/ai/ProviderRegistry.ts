import type { Config } from '../config';
import type { LLMClient } from './LLMClient';
import { GeminiClient } from './GeminiClient';
import { AnthropicClient } from './AnthropicClient';
import { logger } from '../util/logger';

/**
 * Creates LLM client instances for all providers that have valid API keys.
 * Returns a map of provider name → client instance.
 */
export function buildProviderClients(config: Config): Map<string, LLMClient> {
  const clients = new Map<string, LLMClient>();
  const providerConfigs = (config.llm as any).providers ?? {};

  // Gemini
  const googleKey = process.env.GOOGLE_API_KEY;
  if (googleKey) {
    const geminiConf = providerConfigs.gemini ?? {};
    clients.set('gemini', new GeminiClient({
      apiKey: googleKey,
      model: config.llm.model,
      temperature: config.llm.temperature,
      maxTokens: config.llm.chatMaxTokens,
      maxConcurrentRequests: geminiConf.maxConcurrentRequests ?? config.llm.maxConcurrentRequests,
    }));
    logger.info({ provider: 'gemini', model: config.llm.model }, 'Gemini client initialized');
  }

  // Anthropic
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const anthropicConf = providerConfigs.anthropic ?? {};
    clients.set('anthropic', new AnthropicClient({
      apiKey: anthropicKey,
      model: 'claude-sonnet-4-20250514',
      temperature: config.llm.temperature,
      maxTokens: config.llm.chatMaxTokens,
      maxConcurrentRequests: anthropicConf.maxConcurrentRequests ?? config.llm.maxConcurrentRequests,
    }));
    logger.info({ provider: 'anthropic' }, 'Anthropic client initialized');
  }

  if (clients.size === 0) {
    logger.warn('No LLM API keys found — AI features disabled');
  }

  return clients;
}
