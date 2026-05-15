import { IPCChannel } from '../IPCChannel';

/**
 * Proxy for PlayerIntentModel that runs in a worker thread.
 * VoyagerLoop reads intent predictions to bias its task selection,
 * so we forward `predictIntent` over IPC.
 */
export interface IntentPrediction {
  intent: string;
  confidence: number;
  evidence: string[];
  suggestedBotResponse: string;
  suggestedTask?: string;
}

export class PlayerIntentModelProxy {
  constructor(private ipc: IPCChannel) {}

  async predictIntent(playerName: string): Promise<IntentPrediction> {
    return this.ipc.request('playerIntent.predictIntent', [playerName]);
  }
}
