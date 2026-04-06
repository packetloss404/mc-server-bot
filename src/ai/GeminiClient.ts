import { LLMClient, LLMResponse } from './LLMClient';
import { logger } from '../util/logger';

/**
 * Simple concurrency limiter. Tracks active requests and queues
 * callers when the limit is reached.
 */
class Semaphore {
  private active = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    this.active--;
    const next = this.waiting.shift();
    if (next) {
      this.active++;
      next();
    }
  }
}

export class GeminiClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private defaultMaxTokens: number;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/';
  private semaphore: Semaphore;

  constructor(opts: { apiKey: string; model: string; temperature: number; maxTokens: number; maxConcurrentRequests?: number }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.defaultMaxTokens = opts.maxTokens;
    this.semaphore = new Semaphore(opts.maxConcurrentRequests ?? 3);
  }

  async chat(systemPrompt: string, contents: any[], maxTokens?: number): Promise<LLMResponse> {
    await this.semaphore.acquire();
    try {
      const url = `${this.baseUrl}${this.model}:generateContent?key=${this.apiKey}`;

      const body: any = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: this.temperature,
          maxOutputTokens: maxTokens || this.defaultMaxTokens,
          thinkingConfig: {
            thinkingBudget: 128, // Minimal thinking for fast chat responses
          },
        },
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Gemini API ${resp.status}: ${errBody}`);
      }

      const json: any = await resp.json();
      const text = this.extractText(json);
      const usage = json.usageMetadata;

      return {
        text,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
      };
    } finally {
      this.semaphore.release();
    }
  }

  async generate(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<LLMResponse> {
    const contents = [{ role: 'user', parts: [{ text: userMessage }] }];
    return this.chat(systemPrompt, contents, maxTokens);
  }

  /**
   * Generate with thinking enabled — use for code generation tasks
   * where reasoning improves output quality.
   */
  async generateWithThinking(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<LLMResponse> {
    await this.semaphore.acquire();
    try {
      const url = `${this.baseUrl}${this.model}:generateContent?key=${this.apiKey}`;

      const body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: {
          temperature: this.temperature,
          maxOutputTokens: maxTokens || this.defaultMaxTokens,
          thinkingConfig: {
            thinkingBudget: 2048,
          },
        },
      };

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Gemini API ${resp.status}: ${errBody}`);
      }

      const json: any = await resp.json();
      const text = this.extractText(json);
      const usage = json.usageMetadata;

      return {
        text,
        inputTokens: usage?.promptTokenCount,
        outputTokens: usage?.candidatesTokenCount,
      };
    } finally {
      this.semaphore.release();
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    await this.semaphore.acquire();
    try {
      const url = `${this.baseUrl}gemini-embedding-001:batchEmbedContents?key=${this.apiKey}`;
      const requests = texts.map((text) => ({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT',
        outputDimensionality: 256,
      }));
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests }),
        signal: AbortSignal.timeout(30000),
      });
      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Gemini Embedding API ${resp.status}: ${errBody}`);
      }
      const json: any = await resp.json();
      const embeddings = json.embeddings;
      if (!embeddings || !Array.isArray(embeddings)) {
        throw new Error('No embeddings in Gemini response');
      }
      return embeddings.map((e: any) => e.values);
    } finally {
      this.semaphore.release();
    }
  }

  private extractText(json: any): string {
    const candidates = json.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error('No candidates in Gemini response');
    }

    const finishReason = candidates[0].finishReason;
    if (finishReason === 'SAFETY') {
      logger.warn('Gemini response blocked by safety filter');
      return '';
    }
    if (finishReason === 'MAX_TOKENS') {
      logger.warn('Gemini response truncated (MAX_TOKENS)');
    }

    const parts = candidates[0].content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error('No parts in Gemini response');
    }

    // Skip thinking parts (thought: true) — only return actual content
    const contentParts = parts.filter((p: any) => !p.thought);
    if (contentParts.length === 0) {
      // Fallback: if all parts are thinking, return the last part
      return parts[parts.length - 1].text?.trim() || '';
    }
    return contentParts.map((p: any) => p.text || '').join('').trim();
  }
}
