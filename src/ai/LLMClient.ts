import type { LLMCallOptions } from './TaskType';

export type { LLMCallOptions, TaskType } from './TaskType';

export interface LLMResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMClient {
  chat(systemPrompt: string, contents: any[], maxTokens?: number, options?: LLMCallOptions): Promise<LLMResponse>;
  generate(systemPrompt: string, userMessage: string, maxTokens?: number, options?: LLMCallOptions): Promise<LLMResponse>;
  embed?(texts: string[]): Promise<number[][]>;
}

/** Extended interface for clients that support deeper reasoning. */
export interface ThinkingCapableClient extends LLMClient {
  generateWithThinking(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<LLMResponse>;
}
