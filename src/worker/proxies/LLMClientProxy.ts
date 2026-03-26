import { IPCChannel } from '../IPCChannel';
import { LLMClient, LLMResponse } from '../../ai/LLMClient';

export class LLMClientProxy implements LLMClient {
  constructor(private ipc: IPCChannel) {}

  async chat(systemPrompt: string, contents: any[], maxTokens?: number): Promise<LLMResponse> {
    return this.ipc.request('llm.chat', [systemPrompt, contents, maxTokens]);
  }

  async generate(systemPrompt: string, userMessage: string, maxTokens?: number): Promise<LLMResponse> {
    return this.ipc.request('llm.generate', [systemPrompt, userMessage, maxTokens]);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return this.ipc.request('llm.embed', [texts]);
  }
}
