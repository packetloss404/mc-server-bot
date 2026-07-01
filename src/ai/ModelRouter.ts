import * as crypto from 'crypto';
import type { LLMClient, LLMResponse, LLMCallOptions, ThinkingCapableClient } from './LLMClient';
import type { TaskType, RouteConfig } from './TaskType';
import type { TokenLedger } from './TokenLedger';
import { logger } from '../util/logger';

/** HTTP status codes that warrant a retry on the next provider. */
const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504]);

/** HTTP status codes that are terminal — never retry, never fall back. */
const TERMINAL_CODES = new Set([400, 401, 403, 404, 413, 422]);

/** Substrings in error messages that indicate a terminal (non-retryable) condition. */
const TERMINAL_MESSAGE_PATTERNS = [
  'context window',
  'context length',
  'prompt is too long',
  'maximum context',
  'too many tokens',
  'payload too large',
  'request entity too large',
];

/** In-place retries per provider before falling back to the next provider. */
const PER_PROVIDER_RETRIES = 3;
const RETRY_BACKOFF_MS = 500;

/** Circuit breaker: open after this many full-chain failures in a row. */
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30_000;

/** Max entries in the in-memory embedding cache (LRU). */
const EMBED_CACHE_MAX = 256;

interface ModelRouterConfig {
  defaultProvider: string;
  routes?: Record<string, RouteConfig>;
  /** Returns false to refuse all LLM calls (global kill switch). */
  isEnabled?: () => boolean;
  /**
   * Returns false to skip a paid/governed provider for this call (daily budget
   * cap / idle throttle). Non-governed providers should return true so calls
   * fall through to the cheap fallbacks. Defaults to always-allow.
   */
  paidProviderAllowed?: (provider: string, taskType: string) => boolean;
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

/**
 * Thrown when every provider in the chain is a governed/paid provider currently
 * blocked by the daily budget cap or idle throttle. Extends AIDisabledError so
 * callers that already tolerate the kill switch idle instead of crash-looping.
 * (Common case never reaches this: codegen falls through to its cheap fallbacks.)
 */
export class BudgetCappedError extends AIDisabledError {
  code = 'AI_DISABLED';
  constructor(message = 'Daily LLM budget cap reached (enable override to continue)') {
    super(message);
    this.name = 'BudgetCappedError';
  }
}

export function isRetryableError(err: any): boolean {
  const status = err?.status ?? err?.statusCode;
  const message: string = typeof err?.message === 'string' ? err.message.toLowerCase() : '';

  // Status code takes precedence — terminal codes (413, 400, 401, 403, 404, 422) never retry.
  if (typeof status === 'number') {
    if (TERMINAL_CODES.has(status)) return false;
    if (RETRYABLE_CODES.has(status)) return true;
  }

  // Fall back to substring match for providers that don't surface a status (Gemini SDK, etc).
  if (message && TERMINAL_MESSAGE_PATTERNS.some((p) => message.includes(p))) {
    return false;
  }

  return (
    !status ||
    err?.code === 'ECONNRESET' ||
    err?.code === 'ETIMEDOUT' ||
    message.includes('timeout') ||
    message.includes('safety')
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Try to parse `text` as JSON and validate the result against a predicate.
 * Returns `null` on any parse error, predicate failure, or thrown exception
 * inside the predicate. Intended for safely consuming LLM "structured output"
 * responses without sprinkling try/catch at every call site.
 *
 * Not yet wired into existing callers — exposed for future use.
 */
export function parseStructuredOutput<T>(text: string, validate: (x: unknown) => x is T): T | null {
  try {
    const parsed = JSON.parse(text);
    if (validate(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Hash text to a stable cache key (first 16 hex chars of SHA-256). */
function embedCacheKey(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
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
  private paidProviderAllowedFn: (provider: string, taskType: string) => boolean;
  /** Consecutive full-chain failures. Resets on any success. */
  private consecutiveFailures = 0;
  /** When > Date.now(), all LLM calls fast-fail with AIDisabledError. */
  private breakerOpenUntil = 0;
  /** Monotonic counter to give each emitted call event a stable id. */
  private callSeq = 0;
  /** Optional listener (e.g. Socket.IO broadcaster) for live timeline. */
  private onCall?: (event: LLMCallEvent) => void;
  /**
   * Per-process LRU cache for embeddings, keyed by sha256(text) prefix.
   * Map iteration order preserves insertion, so we evict the oldest key on
   * overflow and re-insert on hit to bump recency. Bounded at EMBED_CACHE_MAX
   * entries (~256) which is plenty for a single bot session.
   */
  private embedCache: Map<string, number[]> = new Map();

  constructor(clients: Map<string, LLMClient>, config: ModelRouterConfig, ledger: TokenLedger) {
    this.clients = clients;
    this.defaultProvider = config.defaultProvider;
    this.ledger = ledger;
    this.isEnabledFn = config.isEnabled ?? (() => true);
    this.paidProviderAllowedFn = config.paidProviderAllowed ?? (() => true);

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

    // In-memory cache: check each input against the LRU before paying for an API call.
    // Build a result array seeded with cache hits and the list of indices that still
    // need to be embedded. On total cache hit, return immediately without invoking
    // any provider.
    const result: (number[] | null)[] = new Array(texts.length).fill(null);
    const missIndices: number[] = [];
    const missTexts: string[] = [];
    const missKeys: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      const key = embedCacheKey(texts[i]);
      const cached = this.embedCache.get(key);
      if (cached) {
        // Re-insert to mark as recently used (LRU bump).
        this.embedCache.delete(key);
        this.embedCache.set(key, cached);
        result[i] = cached;
      } else {
        missIndices.push(i);
        missTexts.push(texts[i]);
        missKeys.push(key);
      }
    }
    if (missTexts.length === 0) {
      return result as number[][];
    }

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
        const fetched = await client.embed(missTexts);
        // Populate cache + final result in input order.
        for (let j = 0; j < missIndices.length; j++) {
          const vec = fetched[j];
          if (!vec) continue;
          result[missIndices[j]] = vec;
          this.cacheEmbedding(missKeys[j], vec);
        }
        const end = Date.now();
        // Only count tokens for texts actually sent to the provider (cache misses).
        const inputTokens = missTexts.join(' ').split(/\s+/).length; // rough estimate
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
        return result as number[][];
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

    // Budget/idle gate: drop any governed provider that's currently capped so the
    // call degrades to its cheap fallbacks instead of spending. If the whole chain
    // is governed-and-blocked, idle like the kill switch (BudgetCappedError).
    const gatedChain = providerChain.filter((p) => this.paidProviderAllowedFn(p, String(taskType)));
    if (gatedChain.length === 0) {
      logger.warn({ taskType, providerChain }, 'All providers blocked by budget cap — idling this call');
      throw new BudgetCappedError();
    }
    if (gatedChain.length !== providerChain.length) {
      logger.info(
        { taskType, skipped: providerChain.filter((p) => !gatedChain.includes(p)), using: gatedChain },
        'Budget cap: skipping paid provider, falling through to cheaper fallback',
      );
    }
    providerChain.length = 0;
    providerChain.push(...gatedChain);

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
            // Exponential backoff with ±20% jitter so concurrent bots' retries
            // don't collide in a thundering herd against the same provider.
            const base = RETRY_BACKOFF_MS * Math.pow(2, attempt);
            const jitter = 0.8 + Math.random() * 0.4;
            await sleep(Math.round(base * jitter));
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

  /**
   * Insert an embedding into the LRU cache, evicting the oldest entry if we're
   * over EMBED_CACHE_MAX. Map iteration order is insertion order, so the first
   * key returned by keys() is the least recently inserted/touched.
   */
  private cacheEmbedding(key: string, vec: number[]): void {
    if (this.embedCache.has(key)) {
      this.embedCache.delete(key);
    } else if (this.embedCache.size >= EMBED_CACHE_MAX) {
      const oldest = this.embedCache.keys().next().value;
      if (oldest !== undefined) this.embedCache.delete(oldest);
    }
    this.embedCache.set(key, vec);
  }
}
