import { LLMClient, LLMResponse } from './LLMClient';
import { logger } from '../util/logger';

export class GeminiClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private temperature: number;
  private defaultMaxTokens: number;
  private baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/';

  constructor(opts: { apiKey: string; model: string; temperature: number; maxTokens: number }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.temperature = opts.temperature;
    this.defaultMaxTokens = opts.maxTokens;
  }

  async chat(systemPrompt: string, contents: any[], maxTokens?: number): Promise<LLMResponse> {
    const url = `${this.baseUrl}${this.model}:generateContent?key=${this.apiKey}`;

    const body = {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: maxTokens || this.defaultMaxTokens,
      },
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
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
  }

  async generate(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<LLMResponse> {
    const contents = [{ role: 'user', parts: [{ text: userMessage }] }];
    return this.chat(systemPrompt, contents, maxTokens);
  }

  private extractText(json: any): string {
    const candidates = json.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error('No candidates in Gemini response');
    }
    const parts = candidates[0].content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error('No parts in Gemini response');
    }
    return parts[0].text.trim();
  }
}
