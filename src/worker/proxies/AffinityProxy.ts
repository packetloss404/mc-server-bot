import { IPCChannel } from '../IPCChannel';

/**
 * Proxy for AffinityManager that runs in a worker thread.
 * Read methods use request (await response), write methods use notify (fire-and-forget).
 */
export class AffinityProxy {
  constructor(private ipc: IPCChannel) {}

  async get(botName: string, playerName: string): Promise<number> {
    return this.ipc.request('affinity.get', [botName, playerName]);
  }

  onPositiveChat(botName: string, playerName: string): void {
    this.ipc.notify('affinity.onPositiveChat', [botName, playerName]);
  }

  onNegativeSentiment(botName: string, playerName: string): void {
    this.ipc.notify('affinity.onNegativeSentiment', [botName, playerName]);
  }

  onHit(botName: string, playerName: string): void {
    this.ipc.notify('affinity.onHit', [botName, playerName]);
  }

  onGift(botName: string, playerName: string): void {
    this.ipc.notify('affinity.onGift', [botName, playerName]);
  }

  async isHostile(botName: string, playerName: string): Promise<boolean> {
    return this.ipc.request('affinity.isHostile', [botName, playerName]);
  }

  async getAllForBot(botName: string): Promise<Record<string, number>> {
    return this.ipc.request('affinity.getAllForBot', [botName]);
  }

  async getAll(): Promise<any> {
    return this.ipc.request('affinity.getAll', []);
  }

  clearBot(botName: string): void {
    this.ipc.notify('affinity.clearBot', [botName]);
  }
}
