import { LLMClient, LLMResponse } from './LLMClient';
import { Semaphore } from '../util/Semaphore';

type GeminiLikeContent = {
  role?: string;
  parts?: Array<{ text?: string }>;
};

/**
 * Anthropic charges cached input tokens at ~10% of the regular rate (the
 * exact ratio depends on TTL — ephemeral 5-min cache is 0.1x). Stable
 * prefixes above ~1024 tokens are cacheable on Sonnet/Opus; below that
 * threshold the server silently ignores cache_control. We use 4096 chars
 * (~1024 tokens at avg English density) as the floor so we don't waste
 * one of the four cache breakpoints on a short prompt.
 */
const CACHEABLE_SYSTEM_THRESHOLD_CHARS = 4096;

export class AnthropicClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private defaultMaxTokens: number;
  private baseUrl = 'https://api.anthropic.com/v1/messages';
  private semaphore: Semaphore;

  constructor(opts: { apiKey: string; model: string; temperature: number; maxTokens: number; maxConcurrentRequests?: number }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.defaultMaxTokens = opts.maxTokens;
    this.semaphore = new Semaphore(opts.maxConcurrentRequests ?? 3);
  }

  async chat(systemPrompt: string, contents: GeminiLikeContent[], maxTokens?: number): Promise<LLMResponse> {
    await this.semaphore.acquire();
    try {
      // Prompt caching: when the system prompt is long enough to benefit
      // (≥ ~1024 tokens), wrap it in a content block with cache_control so
      // Anthropic caches the stable prefix and bills cached re-reads at
      // ~10% of normal input cost. Stable system prompts in this codebase
      // (ACTION_SYSTEM_PROMPT, curriculum/critic templates) easily clear
      // the threshold and repeat verbatim across every call.
      const useCache = systemPrompt.length >= CACHEABLE_SYSTEM_THRESHOLD_CHARS;
      const systemField = useCache
        ? [
            {
              type: 'text' as const,
              text: systemPrompt,
              cache_control: { type: 'ephemeral' as const },
            },
          ]
        : systemPrompt;

      const body: Record<string, any> = {
        model: this.model,
        system: systemField,
        max_tokens: maxTokens || this.defaultMaxTokens,
        messages: this.toAnthropicMessages(contents),
      };
      // Opus 4.6+ / Fable reasoning models reject a custom `temperature` (HTTP
      // 400, which is terminal in ModelRouter — so the codegen/critic fallback to
      // claude-opus-4-8 silently died on every call). Only send temperature for
      // models that accept it (Sonnet/Haiku and older Opus).
      const rejectsTemperature = /claude-(opus-4-(6|7|8|9)|fable|mythos)/i.test(this.model);
      if (!rejectsTemperature) {
        body.temperature = this.temperature;
      }

      const resp = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Anthropic API ${resp.status}: ${errBody}`);
      }

      const json: any = await resp.json();

      return {
        text: this.extractText(json),
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
        cacheCreationInputTokens: json.usage?.cache_creation_input_tokens,
        cacheReadInputTokens: json.usage?.cache_read_input_tokens,
      };
    } finally {
      this.semaphore.release();
    }
  }

  async generate(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<LLMResponse> {
    return this.chat(systemPrompt, [{ role: 'user', parts: [{ text: userMessage }] }], maxTokens);
  }

  private toAnthropicMessages(contents: GeminiLikeContent[]): Array<{ role: 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    for (const content of contents) {
      const role = content.role === 'model' ? 'assistant' : 'user';
      const text = (content.parts || [])
        .map((part) => part.text || '')
        .join('')
        .trim();

      if (!text) {
        continue;
      }

      const previous = messages[messages.length - 1];
      if (previous && previous.role === role) {
        previous.content = `${previous.content}\n\n${text}`;
        continue;
      }

      messages.push({ role, content: text });
    }

    return messages;
  }

  private extractText(json: any): string {
    const content = Array.isArray(json.content) ? json.content : [];
    const text = content
      .filter((part: any) => part?.type === 'text')
      .map((part: any) => part.text || '')
      .join('')
      .trim();

    if (!text) {
      throw new Error('No text in Anthropic response');
    }

    return text;
  }
}
