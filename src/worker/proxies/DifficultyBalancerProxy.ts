import { IPCChannel } from '../IPCChannel';

/**
 * Proxy for DifficultyBalancer that runs in a worker thread.
 * VoyagerLoop only needs to read bot-behavior modifiers from this object,
 * so we expose just that surface here. Reads go through `request`.
 */
export interface BotBehaviorModifiers {
  taskCooldownMultiplier: number;
  preferredTaskTypes: string[];
  chatProbability: number;
  helpRadius: number;
}

export class DifficultyBalancerProxy {
  constructor(private ipc: IPCChannel) {}

  async getBotBehaviorModifiers(): Promise<BotBehaviorModifiers> {
    return this.ipc.request('difficulty.getBotBehaviorModifiers', []);
  }
}
