/* ── Fleet types: squads, roles, autonomy ── */

export interface Squad {
  id: string;
  name: string;
  description: string;
  members: string[]; // bot names
  createdAt: number;
  updatedAt: number;
}

export type AutonomyLevel = 'manual' | 'assisted' | 'autonomous';

export interface RoleAssignment {
  id: string;
  botName: string;
  role: string;
  autonomy: AutonomyLevel;
  /** When set, the bot is under manual override and auto-generation is blocked */
  manualOverride: boolean;
  overrideExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

/* ── Socket event names ── */
export const FLEET_EVENTS = {
  SQUAD_CREATED: 'squad:created',
  SQUAD_UPDATED: 'squad:updated',
  SQUAD_DELETED: 'squad:deleted',
  ROLE_ASSIGNED: 'role:assigned',
  ROLE_UPDATED: 'role:updated',
  ROLE_REMOVED: 'role:removed',
  OVERRIDE_SET: 'override:set',
  OVERRIDE_CLEARED: 'override:cleared',
} as const;
