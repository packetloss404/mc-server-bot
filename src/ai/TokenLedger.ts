import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../util/logger';
import type { TaskType, TokenUsageRecord, UsageMetrics } from './TaskType';

const DATA_PATH = path.join(process.cwd(), 'data', 'token-ledger.json');
const DEBOUNCE_MS = 5000;
const MAX_RECORDS = 10000;

/** Cost per 1M tokens (USD). Update as pricing changes. */
const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  // Gemini (3.5 Flash launched May 2026 at $1.50/$9.00 — Pro-level coding at
  // Flash cost; do NOT reuse the old 2.5-flash $0.15/$0.60 rate for it).
  'gemini-3.5-flash': { input: 1.50, output: 9.00 },
  'gemini-3.5-pro': { input: 2.50, output: 15.0 },
  'gemini-3.1-pro': { input: 2.0, output: 12.0 },
  'gemini-3-flash-preview': { input: 1.50, output: 9.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-flash-preview-05-20': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.5-pro-preview-05-06': { input: 1.25, output: 10.0 },
  'gemini-embedding-001': { input: 0.0, output: 0.0 },
  // Anthropic — legacy Claude 4
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
  'claude-haiku-3-20240307': { input: 0.25, output: 1.25 },
  // Anthropic — current models (rate card as of 2026-07). Opus 4.7/4.8 are
  // $5/$25 — NOT the old $15/$75 Opus-4 pricing. Sonnet 5 uses standard
  // $3/$15 (not the intro $2/$10) so the budget cap errs on the safe side
  // and trips slightly early rather than overshooting.
  'claude-sonnet-5': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
  'claude-opus-4-7': { input: 5.0, output: 25.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  // MiniMax — approximate; refresh if MiniMax publishes an exact rate card.
  'MiniMax-M3': { input: 0.30, output: 1.20 },
};

export class TokenLedger {
  private records: TokenUsageRecord[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.load();
  }

  record(entry: {
    provider: string;
    model: string;
    taskType: TaskType | 'unknown';
    botName: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    success: boolean;
  }): void {
    const cost = this.estimateCost(entry.model, entry.inputTokens, entry.outputTokens);
    const record: TokenUsageRecord = {
      timestamp: Date.now(),
      ...entry,
      estimatedCostUsd: cost,
    };
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }
    this.scheduleSave();
  }

  /**
   * Query raw records, optionally filtered by bot name. Returns oldest-first so
   * waterfall timelines can render left-to-right.
   */
  getRecords(opts: { botName?: string; limit?: number } = {}): TokenUsageRecord[] {
    let filtered = this.records;
    if (opts.botName) {
      filtered = filtered.filter((r) => r.botName === opts.botName);
    }
    const limit = opts.limit ?? 50;
    return filtered.slice(-limit);
  }

  getMetrics(): UsageMetrics {
    let totalCalls = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let totalCost = 0;
    let totalLatency = 0;
    let successCount = 0;
    const byProvider: Record<string, { calls: number; tokens: number; cost: number }> = {};
    const byTaskType: Record<string, { calls: number; tokens: number; cost: number }> = {};
    const byBot: Record<string, { calls: number; tokens: number; cost: number }> = {};

    for (const r of this.records) {
      totalCalls++;
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
      totalCost += r.estimatedCostUsd;
      totalLatency += r.latencyMs;
      if (r.success) successCount++;

      const tokens = r.inputTokens + r.outputTokens;

      if (!byProvider[r.provider]) byProvider[r.provider] = { calls: 0, tokens: 0, cost: 0 };
      byProvider[r.provider].calls++;
      byProvider[r.provider].tokens += tokens;
      byProvider[r.provider].cost += r.estimatedCostUsd;

      if (!byTaskType[r.taskType]) byTaskType[r.taskType] = { calls: 0, tokens: 0, cost: 0 };
      byTaskType[r.taskType].calls++;
      byTaskType[r.taskType].tokens += tokens;
      byTaskType[r.taskType].cost += r.estimatedCostUsd;

      if (r.botName) {
        if (!byBot[r.botName]) byBot[r.botName] = { calls: 0, tokens: 0, cost: 0 };
        byBot[r.botName].calls++;
        byBot[r.botName].tokens += tokens;
        byBot[r.botName].cost += r.estimatedCostUsd;
      }
    }

    return {
      totalCalls,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalEstimatedCostUsd: Math.round(totalCost * 10000) / 10000,
      avgLatencyMs: totalCalls > 0 ? Math.round(totalLatency / totalCalls) : 0,
      successRate: totalCalls > 0 ? Math.round((successCount / totalCalls) * 100) : 0,
      byProvider,
      byTaskType,
      byBot,
    };
  }

  /**
   * Sum of estimated USD spend since the start of the local calendar day,
   * optionally scoped to a provider and/or task type. Drives the daily budget
   * cap. Only records written after the pricing fix carry real cost; older
   * $0-era records simply contribute nothing.
   */
  getSpendTodayUsd(opts: { provider?: string; taskType?: string } = {}): number {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    let sum = 0;
    for (const r of this.records) {
      if (r.timestamp < startOfDay) continue;
      if (opts.provider && r.provider !== opts.provider) continue;
      if (opts.taskType && r.taskType !== opts.taskType) continue;
      sum += r.estimatedCostUsd;
    }
    return sum;
  }

  private estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    const rates = COST_PER_MILLION[model];
    if (!rates) return 0;
    return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveImmediate();
    }, DEBOUNCE_MS);
  }

  private saveImmediate(): void {
    try {
      const dir = path.dirname(DATA_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmpPath = DATA_PATH + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.records.slice(-MAX_RECORDS), null, 2));
      fs.renameSync(tmpPath, DATA_PATH);
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to save token ledger');
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(DATA_PATH)) {
        const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
        if (Array.isArray(data)) {
          this.records = data.slice(-MAX_RECORDS);
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to load token ledger, starting fresh');
    }
  }

  shutdown(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveImmediate();
  }
}
