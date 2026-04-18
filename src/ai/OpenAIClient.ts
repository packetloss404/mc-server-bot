import { LLMClient, LLMResponse } from './LLMClient';

type GeminiLikeContent = {
  role?: string;
  parts?: Array<{ text?: string }>;
};

class Semaphore {
  private active = 0;
  private waiting: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<void> {
    if (this.active < this.max) { this.active++; return; }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }
  release(): void {
    this.active--;
    const next = this.waiting.shift();
    if (next) { this.active++; next(); }
  }
}

/**
 * OpenAI chat client. Uses the standard /v1/chat/completions endpoint.
 * Works with any OpenAI-compatible host via the optional baseUrl override
 * (e.g. Azure OpenAI, OpenRouter, local llama.cpp servers).
 */
export class OpenAIClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private defaultMaxTokens: number;
  private baseUrl: string;
  private semaphore: Semaphore;

  constructor(opts: {
    apiKey: string;
    model: string;
    temperature: number;
    maxTokens: number;
    baseUrl?: string;
    maxConcurrentRequests?: number;
  }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.defaultMaxTokens = opts.maxTokens;
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.semaphore = new Semaphore(opts.maxConcurrentRequests ?? 3);
  }

  async chat(systemPrompt: string, contents: GeminiLikeContent[], maxTokens?: number): Promise<LLMResponse> {
    await this.semaphore.acquire();
    try {
      const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      for (const c of contents) {
        const role: 'user' | 'assistant' = c.role === 'model' || c.role === 'assistant' ? 'assistant' : 'user';
        const text = (c.parts || []).map((p) => p.text || '').join('').trim();
        if (!text) continue;
        const prev = messages[messages.length - 1];
        if (prev && prev.role === role) prev.content += `\n\n${text}`;
        else messages.push({ role, content: text });
      }

      const body = {
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: maxTokens || this.defaultMaxTokens,
      };

      const resp = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`OpenAI API ${resp.status}: ${errBody}`);
      }

      const json: any = await resp.json();
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('No text in OpenAI response');
      return {
        text,
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
      };
    } finally {
      this.semaphore.release();
    }
  }

  async generate(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<LLMResponse> {
    return this.chat(systemPrompt, [{ role: 'user', parts: [{ text: userMessage }] }], maxTokens);
  }

  /** OpenAI text-embedding-3-small / -large via /v1/embeddings. */
  async embed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    const resp = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: texts,
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`OpenAI embeddings ${resp.status}: ${errBody}`);
    }
    const json: any = await resp.json();
    return (json.data || []).map((d: any) => d.embedding as number[]);
  }
}
