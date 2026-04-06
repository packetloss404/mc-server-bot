import { LLMClient, LLMResponse } from './LLMClient';
import { logger } from '../util/logger';

type GeminiLikeContent = {
  role?: string;
  parts?: Array<{ text?: string }>;
};

export class OllamaClient implements LLMClient {
  private baseUrl: string;
  private chatModel: string;
  private codeModel: string;
  private temperature: number;
  private defaultMaxTokens: number;
  private timeoutMs: number;

  constructor(opts: {
    baseUrl?: string;
    chatModel?: string;
    codeModel?: string;
    temperature: number;
    maxTokens: number;
    timeoutMs?: number;
  }) {
    this.baseUrl = (opts.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
    this.chatModel = opts.chatModel || 'llama3.2:3b';
    this.codeModel = opts.codeModel || 'qwen2.5-coder:3b';
    this.temperature = opts.temperature;
    this.defaultMaxTokens = opts.maxTokens;
    this.timeoutMs = opts.timeoutMs || 10000;
  }

  async chat(systemPrompt: string, contents: GeminiLikeContent[], maxTokens?: number): Promise<LLMResponse> {
    const messages = this.toOllamaMessages(systemPrompt, contents);

    const body = {
      model: this.chatModel,
      messages,
      stream: false,
      options: {
        temperature: this.temperature,
        num_predict: maxTokens || this.defaultMaxTokens,
      },
    };

    try {
      const resp = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Ollama API ${resp.status}: ${errBody}`);
      }

      const json: any = await resp.json();
      const text = json.message?.content?.trim() || '';

      if (!text) {
        throw new Error('No content in Ollama chat response');
      }

      return {
        text,
        inputTokens: json.prompt_eval_count,
        outputTokens: json.eval_count,
      };
    } catch (err: any) {
      logger.error({ err: err.message }, 'Ollama chat request failed');
      throw err;
    }
  }

  async generate(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<LLMResponse> {
    const body = {
      model: this.codeModel,
      system: systemPrompt,
      prompt: userMessage,
      stream: false,
      options: {
        temperature: this.temperature,
        num_predict: maxTokens || this.defaultMaxTokens,
      },
    };

    try {
      const resp = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Ollama API ${resp.status}: ${errBody}`);
      }

      const json: any = await resp.json();
      const text = (json.response || '').trim();

      if (!text) {
        throw new Error('No content in Ollama generate response');
      }

      return {
        text,
        inputTokens: json.prompt_eval_count,
        outputTokens: json.eval_count,
      };
    } catch (err: any) {
      logger.error({ err: err.message }, 'Ollama generate request failed');
      throw err;
    }
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error('Ollama embedding not supported, use a cloud provider');
  }

  private toOllamaMessages(
    systemPrompt: string,
    contents: GeminiLikeContent[],
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const entry of contents) {
      const role = entry.role === 'model' ? 'assistant' : 'user';
      const text = (entry.parts || [])
        .map((part) => part.text || '')
        .join('')
        .trim();

      if (!text) continue;

      const previous = messages[messages.length - 1];
      if (previous && previous.role === role) {
        previous.content = `${previous.content}\n\n${text}`;
        continue;
      }

      messages.push({ role, content: text });
    }

    return messages;
  }
}
