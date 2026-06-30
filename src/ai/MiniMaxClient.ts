import { LLMClient, LLMResponse } from './LLMClient';
import { Semaphore } from '../util/Semaphore';
import { logger } from '../util/logger';

type GeminiLikeContent = {
  role?: string;
  parts?: Array<{ text?: string }>;
};

/**
 * MiniMax chat client. Speaks the OpenAI-compatible /chat/completions schema
 * that MiniMax exposes. Base URL defaults to https://api.minimax.io/v1 but
 * can be overridden if you're on the China endpoint or a proxy.
 */
export class MiniMaxClient implements LLMClient {
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
    this.baseUrl = (opts.baseUrl ?? 'https://api.minimax.io/v1').replace(/\/$/, '');
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
        throw new Error(`MiniMax API ${resp.status}: ${errBody}`);
      }

      const json: any = await resp.json();
      const choice = json.choices?.[0];
      const raw = choice?.message?.content?.trim();
      if (!raw) throw new Error('No text in MiniMax response');
      // Truncation guard (mirrors GeminiClient's MAX_TOKENS handling, which
      // MiniMaxClient previously lacked). M2.x/M3 are chain-of-thought models;
      // when the output hits the token cap mid-reasoning the closing </think>
      // and/or the code block never arrive, and the half-written blob would
      // otherwise reach Babel as "Unterminated template". Surface it loudly.
      if (choice?.finish_reason === 'length') {
        logger.warn(
          { model: this.model, outputTokens: json.usage?.completion_tokens },
          'MiniMax response truncated (finish_reason=length) — raise codeGenMaxTokens',
        );
      }
      // Strip chain-of-thought. First closed <think>...</think> blocks, then an
      // UNTERMINATED <think> (truncated before its closing tag) — drop everything
      // from the dangling tag onward so raw reasoning never reaches a code/JSON
      // parser. Fall back to raw only if stripping left nothing.
      let text = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
      text = text.replace(/<think>[\s\S]*$/g, '').trim();
      if (!text) text = raw;
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
}
