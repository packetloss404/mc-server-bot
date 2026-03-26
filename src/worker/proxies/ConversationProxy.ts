import { IPCChannel } from '../IPCChannel';

/**
 * Proxy for ConversationManager that runs in a worker thread.
 * Write methods are fire-and-forget, read methods await response.
 */
export class ConversationProxy {
  constructor(private ipc: IPCChannel) {}

  addPlayerMessage(botName: string, playerName: string, message: string): void {
    this.ipc.notify('conversation.addPlayerMessage', [botName, playerName, message]);
  }

  addBotResponse(botName: string, playerName: string, response: string): void {
    this.ipc.notify('conversation.addBotResponse', [botName, playerName, response]);
  }

  async getHistory(botName: string, playerName: string): Promise<any[]> {
    return this.ipc.request('conversation.getHistory', [botName, playerName]);
  }

  async buildContentsArray(botName: string, playerName: string, newMessage: string): Promise<any[]> {
    return this.ipc.request('conversation.buildContentsArray', [botName, playerName, newMessage]);
  }

  async getAllConversations(botName: string): Promise<Record<string, any[]>> {
    return this.ipc.request('conversation.getAllConversations', [botName]);
  }

  clearBot(botName: string): void {
    this.ipc.notify('conversation.clearBot', [botName]);
  }
}
