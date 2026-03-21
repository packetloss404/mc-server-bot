export interface LLMResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMClient {
  chat(systemPrompt: string, contents: any[], maxTokens?: number): Promise<LLMResponse>;
  generate(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<LLMResponse>;
}
