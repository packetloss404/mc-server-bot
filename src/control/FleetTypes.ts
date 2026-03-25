export interface SquadRecord {
  id: string;
  name: string;
  botNames: string[];
  defaultRole?: string;
  homeMarkerId?: string;
  activeMissionId?: string;
  createdAt: number;
  updatedAt: number;
}

export type RoleType = 'guard' | 'builder' | 'hauler' | 'farmer' | 'miner' | 'scout' | 'merchant' | 'free-agent';

export type AutonomyLevel = 'manual' | 'assisted' | 'autonomous';

export type InterruptPolicy = 'always' | 'confirm-if-busy' | 'never-while-critical';

export type RoleApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface RoleApprovalRequestRecord {
  id: string;
  assignmentId: string;
  assignmentUpdatedAt: number;
  botName: string;
  role: RoleType;
  status: RoleApprovalStatus;
  createdAt: number;
  expiresAt: number;
  decidedAt?: number;
  decidedBy?: string;
  decisionNote?: string;
  missionDraft: {
    type: string;
    title: string;
    description: string;
    assigneeType: 'bot';
    assigneeIds: string[];
    priority: 'normal';
    source: 'role';
  };
}

export interface RoleAssignmentRecord {
  id: string;
  botName: string;
  role: RoleType;
  autonomyLevel: AutonomyLevel;
  homeMarkerId?: string;
  allowedZoneIds: string[];
  preferredMissionTypes: string[];
  loadoutPolicy?: Record<string, unknown>;
  interruptPolicy?: InterruptPolicy;
  updatedAt: number;
}

// Socket event names
export const FLEET_EVENTS = {
  SQUAD_UPDATED: 'squad:updated',
  ROLE_UPDATED: 'role:updated',
} as const;

export const WORLD_EVENTS = {
  MARKER_CREATED: 'marker:created',
  MARKER_UPDATED: 'marker:updated',
  ZONE_UPDATED: 'zone:updated',
  ROUTE_UPDATED: 'route:updated',
} as const;
