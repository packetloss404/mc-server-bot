/* ── RoleManager: one-role-per-bot assignment with autonomy levels ── */

import { randomUUID } from 'crypto';
import { AutonomyLevel, RoleAssignment } from './FleetTypes';

export class RoleManager {
  private assignments: Map<string, RoleAssignment> = new Map();
  /** Secondary index: botName -> assignment id */
  private botIndex: Map<string, string> = new Map();

  assign(botName: string, role: string, autonomy: AutonomyLevel = 'autonomous'): RoleAssignment {
    // Remove any existing assignment for this bot
    const existingId = this.botIndex.get(botName);
    if (existingId) {
      this.assignments.delete(existingId);
    }

    const id = randomUUID();
    const now = Date.now();
    const assignment: RoleAssignment = {
      id,
      botName,
      role,
      autonomy,
      manualOverride: false,
      createdAt: now,
      updatedAt: now,
    };

    this.assignments.set(id, assignment);
    this.botIndex.set(botName, id);
    return assignment;
  }

  get(assignmentId: string): RoleAssignment | undefined {
    return this.assignments.get(assignmentId);
  }

  getByBot(botName: string): RoleAssignment | undefined {
    const id = this.botIndex.get(botName);
    return id ? this.assignments.get(id) : undefined;
  }

  update(assignmentId: string, patch: Partial<Pick<RoleAssignment, 'role' | 'autonomy'>>): RoleAssignment | undefined {
    const a = this.assignments.get(assignmentId);
    if (!a) return undefined;
    if (patch.role !== undefined) a.role = patch.role;
    if (patch.autonomy !== undefined) a.autonomy = patch.autonomy;
    a.updatedAt = Date.now();
    return a;
  }

  remove(assignmentId: string): boolean {
    const a = this.assignments.get(assignmentId);
    if (!a) return false;
    this.botIndex.delete(a.botName);
    this.assignments.delete(assignmentId);
    return true;
  }

  /** Set manual override — blocks auto-generation until cleared or expired */
  setOverride(botName: string, durationMs?: number): RoleAssignment | undefined {
    const a = this.getByBot(botName);
    if (!a) return undefined;
    a.manualOverride = true;
    a.overrideExpiresAt = durationMs ? Date.now() + durationMs : undefined;
    a.updatedAt = Date.now();
    return a;
  }

  /** Clear manual override */
  clearOverride(botName: string): RoleAssignment | undefined {
    const a = this.getByBot(botName);
    if (!a) return undefined;
    a.manualOverride = false;
    a.overrideExpiresAt = undefined;
    a.updatedAt = Date.now();
    return a;
  }

  /** Check if a bot's override has expired and auto-clear it */
  checkExpiry(botName: string): boolean {
    const a = this.getByBot(botName);
    if (!a || !a.manualOverride) return false;
    if (a.overrideExpiresAt && Date.now() >= a.overrideExpiresAt) {
      a.manualOverride = false;
      a.overrideExpiresAt = undefined;
      a.updatedAt = Date.now();
      return true; // was expired and cleared
    }
    return false;
  }

  list(): RoleAssignment[] {
    return [...this.assignments.values()];
  }

  toJSON(): RoleAssignment[] {
    return this.list();
  }

  loadFrom(assignments: RoleAssignment[]): void {
    this.assignments.clear();
    this.botIndex.clear();
    for (const a of assignments) {
      this.assignments.set(a.id, a);
      this.botIndex.set(a.botName, a.id);
    }
  }
}
