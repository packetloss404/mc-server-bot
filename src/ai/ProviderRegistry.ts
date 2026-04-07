import type { Config } from '../config';
import type { LLMClient } from './LLMClient';
import { GeminiClient } from './GeminiClient';
import { AnthropicClient } from './AnthropicClient';
import { OllamaClient } from './OllamaClient';
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

  // Ollama (local, no API key required — opt in via OLLAMA_BASE_URL)
  if (process.env.OLLAMA_BASE_URL) {
    const ollamaConf = providerConfigs.ollama ?? {};
    clients.set('ollama', new OllamaClient({
      baseUrl: process.env.OLLAMA_BASE_URL,
      chatModel: process.env.OLLAMA_CHAT_MODEL || ollamaConf.chatModel || 'llama3.2:3b',
      codeModel: process.env.OLLAMA_CODE_MODEL || ollamaConf.codeModel || 'qwen2.5-coder:3b',
      temperature: config.llm.temperature,
      maxTokens: config.llm.chatMaxTokens,
      timeoutMs: ollamaConf.timeoutMs ?? 30000,
    }));
    logger.info({ provider: 'ollama', baseUrl: process.env.OLLAMA_BASE_URL }, 'Ollama client initialized');
  }

  if (clients.size === 0) {
    logger.warn('No LLM API keys found — AI features disabled');
  }

  return clients;
}
