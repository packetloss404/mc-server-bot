import { LLMClient, LLMResponse } from './LLMClient';

/**
 * Voyage AI client — Anthropic's officially recommended embeddings provider.
 * Voyage doesn't offer chat/completion, so the chat/generate methods throw a
 * descriptive error if invoked. The router should only route the `embed`
 * task type to this provider.
 *
 * Endpoint: POST https://api.voyageai.com/v1/embeddings
 * Docs: https://docs.voyageai.com/docs/embeddings
 */
export class VoyageAIClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(opts: {
    apiKey: string;
    /** Model id like 'voyage-4-large', 'voyage-4', 'voyage-code-3'. */
    model: string;
    baseUrl?: string;
  }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl ?? 'https://api.voyageai.com/v1').replace(/\/$/, '');
  }

  async chat(): Promise<LLMResponse> {
    throw new Error('Voyage AI is an embeddings-only provider; use embed() instead');
  }

  async generate(): Promise<LLMResponse> {
    throw new Error('Voyage AI is an embeddings-only provider; use embed() instead');
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    const resp = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        // Embedding documents (not search queries) is the right default for our
        // skill library and Q&A cache use cases.
        input_type: 'document',
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (!resp.ok) {
      const errBody = await resp.text();
      throw new Error(`Voyage AI embeddings ${resp.status}: ${errBody}`);
    }
    const json: any = await resp.json();
    const data: any[] = Array.isArray(json.data) ? json.data : [];
    return data.map((d) => d.embedding as number[]);
  }
}
