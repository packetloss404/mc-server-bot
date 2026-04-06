/**
 * Task types for LLM call routing.
 * Each type maps to a different model/provider configuration.
 */
export type TaskType = 'codegen' | 'curriculum' | 'critic' | 'chat' | 'embed';

/** Options passed with every LLM call for routing and tracking. */
export interface LLMCallOptions {
  /** Which task category this call belongs to — determines model routing. */
  taskType?: TaskType;
  /** Bot making the call — for per-bot cost tracking. */
  botName?: string;
}

/** Per-task-type routing configuration (from config.yml). */
export interface RouteConfig {
  provider: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** If true and the provider supports it, use extended thinking mode. */
  useThinking?: boolean;
  /** Ordered list of fallback provider names on failure. */
  fallback?: string[];
}

/** Token usage record for the ledger. */
export interface TokenUsageRecord {
  timestamp: number;
  provider: string;
  model: string;
  taskType: TaskType | 'unknown';
  botName: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  success: boolean;
}

/** Aggregated usage metrics. */
export interface UsageMetrics {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number;
  avgLatencyMs: number;
  successRate: number;
  byProvider: Record<string, { calls: number; tokens: number; cost: number }>;
  byTaskType: Record<string, { calls: number; tokens: number; cost: number }>;
  byBot: Record<string, { calls: number; tokens: number; cost: number }>;
}
