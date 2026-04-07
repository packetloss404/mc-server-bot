import { IPCChannel } from '../IPCChannel';
import type { SharedResourceRecord, SharedThreatRecord, BotStateRecord } from '../../voyager/SharedWorldModel';

/**
 * Worker-thread proxy for the main-thread SharedWorldModel singleton.
 * All updates are fire-and-forget notifications; reads go via request().
 */
export class SharedWorldProxy {
  constructor(private ipc: IPCChannel) {}

  reportResource(botName: string, record: SharedResourceRecord): void {
    this.ipc.notify('sharedWorld.reportResource', [botName, record]);
  }

  reportThreat(botName: string, threat: SharedThreatRecord): void {
    this.ipc.notify('sharedWorld.reportThreat', [botName, threat]);
  }

  updateBotState(state: BotStateRecord): void {
    this.ipc.notify('sharedWorld.updateBotState', [state]);
  }

  markChunkExplored(chunkX: number, chunkZ: number): void {
    this.ipc.notify('sharedWorld.markChunkExplored', [chunkX, chunkZ]);
  }

  updateServerState(time: number, weather: string): void {
    this.ipc.notify('sharedWorld.updateServerState', [time, weather]);
  }
}
