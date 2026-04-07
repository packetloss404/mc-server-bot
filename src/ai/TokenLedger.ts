import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../util/logger';
import type { TaskType, TokenUsageRecord, UsageMetrics } from './TaskType';

const DATA_PATH = path.join(process.cwd(), 'data', 'token-ledger.json');
const DEBOUNCE_MS = 5000;
const MAX_RECORDS = 10000;

/** Cost per 1M tokens (USD). Update as pricing changes. */
const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  // Gemini
  'gemini-3-flash-preview': { input: 0.15, output: 0.60 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-flash-preview-05-20': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.5-pro-preview-05-06': { input: 1.25, output: 10.0 },
  'gemini-embedding-001': { input: 0.0, output: 0.0 },
  // Anthropic
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
  'claude-opus-4-20250514': { input: 15.0, output: 75.0 },
  'claude-haiku-3-20240307': { input: 0.25, output: 1.25 },
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
