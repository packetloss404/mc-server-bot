// Command types for the control platform

import type { MissionRecord } from './MissionTypes';

export type CommandType =
  | 'pause_voyager'
  | 'resume_voyager'
  | 'stop_movement'
  | 'follow_player'
  | 'walk_to_coords'
  | 'move_to_marker'
  | 'return_to_base'
  | 'regroup'
  | 'guard_zone'
  | 'patrol_route'
  | 'deposit_inventory'
  | 'equip_best'
  | 'unstuck';

export type CommandScope = 'bot' | 'squad' | 'selection';

export type CommandPriority = 'low' | 'normal' | 'high' | 'urgent';

export type CommandSource = 'dashboard' | 'map' | 'role' | 'routine' | 'commander' | 'api';

export type CommandStatus = 'queued' | 'started' | 'succeeded' | 'failed' | 'cancelled';

export interface CommandError {
  code: string;
  message: string;
  retryable?: boolean;
}

export interface CommandRecord {
  id: string;
  type: CommandType;
  scope: CommandScope;
  targets: string[];
  payload: Record<string, unknown>;
  priority: CommandPriority;
  source: CommandSource;
  requestedBy?: string;
  status: CommandStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: Record<string, unknown>;
  error?: CommandError;
}

export interface CommanderPlan {
  id: string;
  input: string;
  parsedIntent: string;
  confidence: number;
  requiresConfirmation: boolean;
  warnings: string[];
  commands: CommandRecord[];
  missions: MissionRecord[];
}

// Socket event names
export const COMMAND_EVENTS = {
  QUEUED: 'command:queued',
  STARTED: 'command:started',
  SUCCEEDED: 'command:succeeded',
  FAILED: 'command:failed',
  CANCELLED: 'command:cancelled',
} as const;
