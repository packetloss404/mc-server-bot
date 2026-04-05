import { MissionRecord, MissionType } from './MissionTypes';

export interface MissionFilters {
  bot?: string;
  status?: string;
  type?: string;
}

export interface CreateMissionParams {
  type: MissionType;
  title: string;
  description?: string;
  assigneeType: 'bot' | 'squad';
  assigneeIds: string[];
  priority: string;
  source: string;
}

/**
 * Minimal MissionManager interface used by RoleManager.
 * The full implementation lives in the main repo; this stub allows
 * RoleManager to compile in this worktree.
 */
export class MissionManager {
  getMissions(_filters?: MissionFilters): MissionRecord[] {
    return [];
  }

  createMission(_params: CreateMissionParams): MissionRecord {
    throw new Error('MissionManager stub — not implemented in this worktree');
  }

  cancelMission(_id: string): MissionRecord | undefined {
    return undefined;
  }
}
