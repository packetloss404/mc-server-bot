import { IPCChannel } from '../IPCChannel';

/**
 * Proxy for BlackboardManager that runs in a worker thread.
 * All methods forward to the main thread via IPC.
 */
export class BlackboardProxy {
  constructor(private ipc: IPCChannel) {}

  async setSwarmGoal(rawRequest: string, requestedBy: string, tasks: any[]): Promise<any> {
    return this.ipc.request('blackboard.setSwarmGoal', [rawRequest, requestedBy, tasks]);
  }

  async setBotGoal(botName: string, goal: any): Promise<void> {
    return this.ipc.request('blackboard.setBotGoal', [botName, goal]);
  }

  async clearBotGoal(botName: string): Promise<void> {
    return this.ipc.request('blackboard.clearBotGoal', [botName]);
  }

  async addTask(task: any, source: string, goalId?: string): Promise<any> {
    return this.ipc.request('blackboard.addTask', [task, source, goalId]);
  }

  async claimBestTask(botName: string, query?: string): Promise<any> {
    return this.ipc.request('blackboard.claimBestTask', [botName, query]);
  }

  async completeTask(taskDescription: string, botName: string): Promise<void> {
    this.ipc.notify('blackboard.completeTask', [taskDescription, botName]);
  }

  async blockTask(taskDescription: string, botName: string, blocker: string): Promise<void> {
    this.ipc.notify('blackboard.blockTask', [taskDescription, botName, blocker]);
  }

  async postMessage(botName: string, kind: string, text: string): Promise<void> {
    this.ipc.notify('blackboard.postMessage', [botName, kind, text]);
  }

  async getState(): Promise<any> {
    return this.ipc.request('blackboard.getState', []);
  }

  async getRecentMessages(limit?: number): Promise<any[]> {
    return this.ipc.request('blackboard.getRecentMessages', [limit]);
  }

  async getSwarmGoal(): Promise<any> {
    return this.ipc.request('blackboard.getSwarmGoal', []);
  }

  async claimReservation(type: string, key: string, botName: string, goalId?: string, ttlMs?: number): Promise<boolean> {
    return this.ipc.request('blackboard.claimReservation', [type, key, botName, goalId, ttlMs]);
  }

  async releaseReservationsForBot(botName: string, prefix?: string): Promise<void> {
    this.ipc.notify('blackboard.releaseReservationsForBot', [botName, prefix]);
  }

  async hasReservation(type: string, key: string, botName?: string): Promise<boolean> {
    return this.ipc.request('blackboard.hasReservation', [type, key, botName]);
  }
}
