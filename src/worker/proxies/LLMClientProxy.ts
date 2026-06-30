import { IPCChannel } from '../IPCChannel';
import { LLMClient, LLMResponse, LLMCallOptions } from '../../ai/LLMClient';

export class LLMClientProxy implements LLMClient {
  constructor(private ipc: IPCChannel) {}

  // options ({taskType, botName}) is forwarded as the 4th IPC arg so the
  // main-thread ModelRouter can route per task type. Previously dropped here,
  // which made every fleet call dispatch as 'chat' and all per-task routes dead.
  async chat(systemPrompt: string, contents: any[], maxTokens?: number, options?: LLMCallOptions): Promise<LLMResponse> {
    return this.ipc.request('llm.chat', [systemPrompt, contents, maxTokens, options]);
  }

  async generate(systemPrompt: string, userMessage: string, maxTokens?: number, options?: LLMCallOptions): Promise<LLMResponse> {
    return this.ipc.request('llm.generate', [systemPrompt, userMessage, maxTokens, options]);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return this.ipc.request('llm.embed', [texts]);
  }
}
