import type { LLMClient, LLMResponse, LLMCallOptions, ThinkingCapableClient } from './LLMClient';
import type { TaskType, RouteConfig } from './TaskType';
import type { TokenLedger } from './TokenLedger';
import { logger } from '../util/logger';

/** HTTP status codes that warrant a retry on the next provider. */
const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

/** In-place retries per provider before falling back to the next provider. */
const PER_PROVIDER_RETRIES = 1;
const RETRY_BACKOFF_MS = 500;

/** Circuit breaker: open after this many full-chain failures in a row. */
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30_000;

interface ModelRouterConfig {
  defaultProvider: string;
  routes?: Record<string, RouteConfig>;
  /** Returns false to refuse all LLM calls (global kill switch). */
  isEnabled?: () => boolean;
}

/** A snapshot of one LLM call, emitted for live timeline visualization. */
export interface LLMCallEvent {
  id: string;
  taskType: string;
  provider: string;
  model: string;
  botName: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  success: boolean;
  error?: string;
}

/** Error type thrown when the AI kill switch is off. Callers should detect and skip. */
export class AIDisabledError extends Error {
  code = 'AI_DISABLED';
  constructor(message = 'AI is disabled (kill switch)') {
    super(message);
    this.name = 'AIDisabledError';
  }
}

function isRetryableError(err: any): boolean {
  const status = err?.status ?? err?.statusCode;
  return (
    !status ||
    RETRYABLE_CODES.has(status) ||
    err?.code === 'ECONNRESET' ||
    err?.code === 'ETIMEDOUT' ||
    err?.message?.includes('timeout') ||
    err?.message?.includes('SAFETY')
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  /** Consecutive full-chain failures. Resets on any success. */
  private consecutiveFailures = 0;
  /** When > Date.now(), all LLM calls fast-fail with AIDisabledError. */
  private breakerOpenUntil = 0;
  /** Monotonic counter to give each emitted call event a stable id. */
  private callSeq = 0;
  /** Optional listener (e.g. Socket.IO broadcaster) for live timeline. */
  private onCall?: (event: LLMCallEvent) => void;

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

  /** Register a listener that fires after every LLM call (success or failure). */
  setCallListener(fn: (event: LLMCallEvent) => void): void {
    this.onCall = fn;
  }

  private emitCall(event: LLMCallEvent): void {
    try { this.onCall?.(event); } catch { /* swallow listener errors */ }
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
    this.assertEnabled();

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
        const end = Date.now();
        const inputTokens = texts.join(' ').split(/\s+/).length; // rough estimate
        this.ledger.record({
          provider: name,
          model: route?.model ?? 'embedding',
          taskType: 'embed',
          botName: '',
          inputTokens,
          outputTokens: 0,
          latencyMs: end - start,
          success: true,
        });
        this.emitCall({
          id: `llm-${++this.callSeq}`,
          taskType: 'embed',
          provider: name,
          model: route?.model ?? 'embedding',
          botName: '',
          startMs: start,
          endMs: end,
          durationMs: end - start,
          inputTokens,
          outputTokens: 0,
          success: true,
        });
        this.recordSuccess();
        return result;
      } catch (err: any) {
        const end = Date.now();
        lastError = err;
        this.emitCall({
          id: `llm-${++this.callSeq}`,
          taskType: 'embed',
          provider: name,
          model: route?.model ?? 'embedding',
          botName: '',
          startMs: start,
          endMs: end,
          durationMs: end - start,
          inputTokens: 0,
          outputTokens: 0,
          success: false,
          error: err?.message,
        });
        logger.warn({ provider: name, err: err.message }, 'Embed failed, trying next provider');
      }
    }
    this.recordFullChainFailure();
    throw lastError ?? new Error('No provider supports embeddings');
  }

  /** Core dispatch logic with fallback chain and ledger recording. */
  private async dispatch(
    method: 'chat' | 'generate',
    options: LLMCallOptions | undefined,
    callFn: (client: LLMClient, maxTokens?: number) => Promise<LLMResponse>,
    maxTokens?: number,
  ): Promise<LLMResponse> {
    this.assertEnabled();
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

      // Try the same provider up to (1 + PER_PROVIDER_RETRIES) times for transient
      // errors, with exponential backoff. Non-retryable errors bail immediately.
      for (let attempt = 0; attempt <= PER_PROVIDER_RETRIES; attempt++) {
        const start = Date.now();
        try {
          const response = await callFn(client, effectiveMaxTokens);
          const end = Date.now();
          const latencyMs = end - start;

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

          this.emitCall({
            id: `llm-${++this.callSeq}`,
            taskType: String(taskType),
            provider: providerName,
            model: route?.model ?? this.defaultProvider,
            botName,
            startMs: start,
            endMs: end,
            durationMs: latencyMs,
            inputTokens: response.inputTokens ?? 0,
            outputTokens: response.outputTokens ?? 0,
            success: true,
          });

          this.recordSuccess();
          return response;
        } catch (err: any) {
          const end = Date.now();
          const latencyMs = end - start;
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

          this.emitCall({
            id: `llm-${++this.callSeq}`,
            taskType: String(taskType),
            provider: providerName,
            model: route?.model ?? this.defaultProvider,
            botName,
            startMs: start,
            endMs: end,
            durationMs: latencyMs,
            inputTokens: 0,
            outputTokens: 0,
            success: false,
            error: err?.message,
          });

          if (!isRetryableError(err)) {
            throw err; // 400, 401, 403 — don't retry, don't fall back
          }

          const willRetrySameProvider = attempt < PER_PROVIDER_RETRIES;
          logger.warn(
            { provider: providerName, taskType, err: err.message, status: err.status ?? err.statusCode, attempt: attempt + 1, willRetry: willRetrySameProvider },
            willRetrySameProvider ? `LLM ${method} failed, retrying same provider` : `LLM ${method} failed, trying fallback`,
          );

          if (willRetrySameProvider) {
            await sleep(RETRY_BACKOFF_MS * Math.pow(2, attempt));
            continue;
          }
          break; // exhausted retries for this provider, move to next in chain
        }
      }
    }

    this.recordFullChainFailure();
    throw lastError ?? new Error(`All providers failed for ${method} (${taskType})`);
  }

  /** Throws AIDisabledError if the kill switch is off or the breaker is open. */
  private assertEnabled(): void {
    if (!this.isEnabledFn()) throw new AIDisabledError();
    if (this.breakerOpenUntil > Date.now()) {
      const remaining = Math.ceil((this.breakerOpenUntil - Date.now()) / 1000);
      throw new AIDisabledError(`LLM circuit breaker open (cooldown ${remaining}s)`);
    }
  }

  private recordSuccess(): void {
    if (this.consecutiveFailures > 0 || this.breakerOpenUntil !== 0) {
      logger.info({ consecutiveFailures: this.consecutiveFailures }, 'ModelRouter: circuit reset');
    }
    this.consecutiveFailures = 0;
    this.breakerOpenUntil = 0;
  }

  private recordFullChainFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= BREAKER_THRESHOLD && this.breakerOpenUntil <= Date.now()) {
      this.breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
      logger.warn(
        { consecutiveFailures: this.consecutiveFailures, cooldownMs: BREAKER_COOLDOWN_MS },
        'ModelRouter: circuit breaker opened',
      );
    }
  }

  private isThinkingCapable(client: LLMClient): client is ThinkingCapableClient {
    return typeof (client as any).generateWithThinking === 'function';
  }
}
