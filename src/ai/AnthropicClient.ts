import { LLMClient, LLMResponse } from './LLMClient';

type GeminiLikeContent = {
  role?: string;
  parts?: Array<{ text?: string }>;
};

export class AnthropicClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private defaultMaxTokens: number;
  private baseUrl = 'https://api.anthropic.com/v1/messages';

  constructor(opts: { apiKey: string; model: string; temperature: number; maxTokens: number }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.defaultMaxTokens = opts.maxTokens;
  }

  async chat(systemPrompt: string, contents: GeminiLikeContent[], maxTokens?: number): Promise<LLMResponse> {
    const body = {
      model: this.model,
      system: systemPrompt,
      temperature: this.temperature,
      max_tokens: maxTokens || this.defaultMaxTokens,
      messages: this.toAnthropicMessages(contents),
    };

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
    };
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
