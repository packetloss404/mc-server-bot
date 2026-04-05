// =======================================
//  COMMAND TYPES FOR CONTROL PLATFORM
// =======================================

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

export type CommandScope = 'single' | 'squad' | 'selection' | 'all';

export type CommandPriority = 'low' | 'normal' | 'high' | 'critical';

export type CommandSource = 'dashboard' | 'api' | 'hotkey' | 'automated' | 'commander';

export type CommandStatus =
  | 'queued'
  | 'started'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface CommandError {
  code: string;
  message: string;
  botName?: string;
}

export interface CommandRecord {
  id: string;
  type: CommandType;
  scope: CommandScope;
  priority: CommandPriority;
  source: CommandSource;
  status: CommandStatus;
  targets: string[];            // bot names
  params: Record<string, any>;  // type-specific parameters
  createdAt: string;            // ISO timestamp
  startedAt?: string;
  completedAt?: string;
  error?: CommandError;
  result?: Record<string, any>;
  childCommandIds?: string[];   // for fan-out commands
  parentCommandId?: string;
}

export const COMMAND_EVENTS = {
  QUEUED: 'command:queued',
  STARTED: 'command:started',
  SUCCEEDED: 'command:succeeded',
  FAILED: 'command:failed',
  CANCELLED: 'command:cancelled',
} as const;

// Commander plan types
export interface CommanderPlanCommand {
  type: CommandType;
  targets: string[];
  payload: Record<string, any>;
}

export interface CommanderPlanMission {
  type: string;
  title: string;
  description?: string;
  assigneeIds: string[];
}

export interface CommanderPlan {
  id: string;
  input: string;
  intent: string;
  confidence: number;
  warnings: string[];
  requiresConfirmation: boolean;
  commands: CommanderPlanCommand[];
  missions: CommanderPlanMission[];
  createdAt: string;
}
