/* ── Mission types for the control platform ── */

export type MissionStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export type MissionPriority = 'low' | 'normal' | 'high' | 'critical';

export interface MissionStep {
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface Mission {
  id: string;
  name: string;
  description: string;
  botName: string;
  status: MissionStatus;
  priority: MissionPriority;
  steps: MissionStep[];
  currentStepIndex: number;
  /** Missions that must complete before this one can start */
  dependencies: string[];
  source: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  /** If true, requires approval before auto-starting (for assisted mode) */
  requiresApproval: boolean;
  approved: boolean;
  /** Number of retry attempts remaining */
  retriesLeft: number;
  /** Template ID this mission was created from, if any */
  templateId?: string;
}

export interface MissionQueue {
  botName: string;
  missions: string[]; // mission IDs in priority order
}

export interface MissionCreateParams {
  name: string;
  description: string;
  botName: string;
  priority?: MissionPriority;
  steps?: Array<{ description: string }>;
  dependencies?: string[];
  source?: string;
  requiresApproval?: boolean;
  retriesLeft?: number;
  templateId?: string;
}
