/**
 * MissionManager — creates and manages multi-step missions for bots.
 * Stub: real implementation will replace this file.
 */

export type MissionStatus = 'pending' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface MissionRecord {
  id: string;
  botName: string;
  name: string;
  description: string;
  status: MissionStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

let idCounter = 0;

export class MissionManager {
  private missions: Map<string, MissionRecord> = new Map();
  private io: { emit: (...args: any[]) => void } | null;

  constructor(io?: any) {
    this.io = io ?? null;
  }

  createMission(botName: string, name: string, description: string = ''): MissionRecord {
    const now = Date.now();
    const id = `mission-${++idCounter}-${now}`;
    const record: MissionRecord = {
      id,
      botName,
      name,
      description,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };
    this.missions.set(id, record);
    this.emitEvent('mission:created', record);
    return record;
  }

  setStatus(id: string, status: MissionStatus, error?: string): MissionRecord {
    const record = this.missions.get(id);
    if (!record) throw new Error(`Mission ${id} not found`);
    record.status = status;
    record.updatedAt = Date.now();
    if (error) record.error = error;
    this.emitEvent(`mission:${status}`, record);
    return record;
  }

  cancel(id: string): MissionRecord {
    return this.setStatus(id, 'cancelled');
  }

  getMissions(botName?: string): MissionRecord[] {
    const all = Array.from(this.missions.values());
    return botName ? all.filter((m) => m.botName === botName) : all;
  }

  getMission(id: string): MissionRecord | undefined {
    return this.missions.get(id);
  }

  private emitEvent(event: string, record: MissionRecord): void {
    if (this.io) {
      this.io.emit(event, record);
    }
  }
}
