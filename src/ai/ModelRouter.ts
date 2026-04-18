import type { LLMClient, LLMResponse, LLMCallOptions, ThinkingCapableClient } from './LLMClient';
import type { TaskType, RouteConfig } from './TaskType';
import type { TokenLedger } from './TokenLedger';
import { logger } from '../util/logger';

/** HTTP status codes that warrant a retry on the next provider. */
const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

interface ModelRouterConfig {
  defaultProvider: string;
  routes?: Record<string, RouteConfig>;
  /** Returns false to refuse all LLM calls (global kill switch). */
  isEnabled?: () => boolean;
}

/** Error type thrown when the AI kill switch is off. Callers should detect and skip. */
export class AIDisabledError extends Error {
  code = 'AI_DISABLED';
  constructor() {
    super('AI is disabled (kill switch)');
    this.name = 'AIDisabledError';
  }
}

/**
 * Routes LLM calls to different providers based on task type.
 * Implements LLMClient so it's a drop-in replacement for any single client.
 */
export class ModelRouter implements LLMClient {
  private clients: Map<string, LLMClient>;
  private routes: Map<TaskType, RouteConfig>;
  private defaultProvider: string;
  private ledger: TokenLedger;
  private isEnabledFn: () => boolean;

  constructor(clients: Map<string, LLMClient>, config: ModelRouterConfig, ledger: TokenLedger) {
    this.clients = clients;
    this.defaultProvider = config.defaultProvider;
    this.ledger = ledger;
    this.isEnabledFn = config.isEnabled ?? (() => true);

    this.routes = new Map();
    if (config.routes) {
      for (const [key, route] of Object.entries(config.routes)) {
        this.routes.set(key as TaskType, route);
      }
    }

    logger.info(
      { providers: [...clients.keys()], routes: [...this.routes.keys()], default: this.defaultProvider },
      'ModelRouter initialized',
    );
  }

  async chat(
    systemPrompt: string,
    contents: any[],
    maxTokens?: number,
    options?: LLMCallOptions,
  ): Promise<LLMResponse> {
    return this.dispatch('chat', options, (client, mTokens) =>
      client.chat(systemPrompt, contents, mTokens),
      maxTokens,
    );
  }

  async generate(
    systemPrompt: string,
    userMessage: string,
    maxTokens?: number,
    options?: LLMCallOptions,
  ): Promise<LLMResponse> {
    const taskType = options?.taskType ?? 'chat';
    const route = this.routes.get(taskType);

    // If codegen with thinking enabled, try thinking-capable client
    if (route?.useThinking && taskType === 'codegen') {
      return this.dispatch('generate', options, (client, mTokens) => {
        if (this.isThinkingCapable(client)) {
          return client.generateWithThinking(systemPrompt, userMessage, mTokens);
        }
        return client.generate(systemPrompt, userMessage, mTokens);
      }, maxTokens);
    }

    return this.dispatch('generate', options, (client, mTokens) =>
      client.generate(systemPrompt, userMessage, mTokens),
      maxTokens,
    );
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.isEnabledFn()) throw new AIDisabledError();

    // Build provider chain — honor the 'embed' route + its fallback list first,
    // then fall back to any other provider that supports embed().
    const route = this.routes.get('embed');
    const seen = new Set<string>();
    const chain: string[] = [];
    const push = (n?: string) => { if (n && !seen.has(n)) { seen.add(n); chain.push(n); } };
    push(route?.provider);
    for (const f of route?.fallback ?? []) push(f);
    for (const name of this.clients.keys()) push(name);

    let lastError: Error | null = null;
    for (const name of chain) {
      const client = this.clients.get(name);
      if (!client?.embed) continue;
      const start = Date.now();
      try {
        const result = await client.embed(texts);
        this.ledger.record({
          provider: name,
          model: route?.model ?? 'embedding',
          taskType: 'embed',
          botName: '',
          inputTokens: texts.join(' ').split(/\s+/).length, // rough estimate
          outputTokens: 0,
          latencyMs: Date.now() - start,
          success: true,
        });
        return result;
      } catch (err: any) {
        lastError = err;
        logger.warn({ provider: name, err: err.message }, 'Embed failed, trying next provider');
      }
    }
    throw lastError ?? new Error('No provider supports embeddings');
  }

  /** Core dispatch logic with fallback chain and ledger recording. */
  private async dispatch(
    method: 'chat' | 'generate',
    options: LLMCallOptions | undefined,
    callFn: (client: LLMClient, maxTokens?: number) => Promise<LLMResponse>,
    maxTokens?: number,
  ): Promise<LLMResponse> {
    if (!this.isEnabledFn()) throw new AIDisabledError();
    const taskType = options?.taskType ?? 'chat';
    const botName = options?.botName ?? '';
    const route = this.routes.get(taskType as TaskType);

    // Build provider chain: [primary, ...fallbacks]
    const providerChain: string[] = [];
    if (route?.provider) {
      providerChain.push(route.provider);
      if (route.fallback) providerChain.push(...route.fallback);
    }
    if (!providerChain.includes(this.defaultProvider)) {
      providerChain.push(this.defaultProvider);
    }

    const effectiveMaxTokens = route?.maxTokens ?? maxTokens;

    let lastError: Error | null = null;
    for (const providerName of providerChain) {
      const client = this.clients.get(providerName);
      if (!client) continue;

      const start = Date.now();
      try {
        const response = await callFn(client, effectiveMaxTokens);
        const latencyMs = Date.now() - start;

        this.ledger.record({
          provider: providerName,
          model: route?.model ?? this.defaultProvider,
          taskType: taskType as TaskType | 'unknown',
          botName,
          inputTokens: response.inputTokens ?? 0,
          outputTokens: response.outputTokens ?? 0,
          latencyMs,
          success: true,
        });

        return response;
      } catch (err: any) {
        const latencyMs = Date.now() - start;
        lastError = err;

        this.ledger.record({
          provider: providerName,
          model: route?.model ?? this.defaultProvider,
          taskType: taskType as TaskType | 'unknown',
          botName,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs,
          success: false,
        });

        // Check if retryable
        const status = err.status ?? err.statusCode;
        const isRetryable = !status || RETRYABLE_CODES.has(status) ||
          err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' ||
          err.message?.includes('timeout') || err.message?.includes('SAFETY');

        if (!isRetryable) {
          throw err; // 400, 401, 403 — don't retry
        }

        logger.warn(
          { provider: providerName, taskType, err: err.message, status },
          `LLM ${method} failed, trying fallback`,
        );
      }
    }

    throw lastError ?? new Error(`All providers failed for ${method} (${taskType})`);
  }

  private isThinkingCapable(client: LLMClient): client is ThinkingCapableClient {
    return typeof (client as any).generateWithThinking === 'function';
  }
}
