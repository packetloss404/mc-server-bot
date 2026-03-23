export type MissionType =
  | 'queue_task'
  | 'gather_items'
  | 'craft_items'
  | 'smelt_batch'
  | 'build_schematic'
  | 'supply_chain'
  | 'patrol_zone'
  | 'escort_player'
  | 'resupply_builder';

export type MissionStatus = 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type MissionPriority = 'low' | 'normal' | 'high' | 'urgent';

export type MissionSource = 'dashboard' | 'map' | 'role' | 'routine' | 'commander';

export interface MissionStep {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  error?: string;
}

export interface MissionRecord {
  id: string;
  type: MissionType;
  title: string;
  description?: string;
  assigneeType: 'bot' | 'squad';
  assigneeIds: string[];
  status: MissionStatus;
  priority: MissionPriority;
  steps: MissionStep[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  blockedReason?: string;
  linkedCommandIds?: string[];
  source: MissionSource;
}

// Socket event names
export const MISSION_EVENTS = {
  CREATED: 'mission:created',
  UPDATED: 'mission:updated',
  COMPLETED: 'mission:completed',
  FAILED: 'mission:failed',
  CANCELLED: 'mission:cancelled',
} as const;
