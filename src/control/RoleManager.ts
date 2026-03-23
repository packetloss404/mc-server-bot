import { Server as SocketIOServer } from 'socket.io';
import { RoleAssignmentRecord, RoleType, AutonomyLevel, FLEET_EVENTS } from './FleetTypes';
import { logger } from '../util/logger';
import * as fs from 'fs';
import * as path from 'path';

const VALID_ROLES: RoleType[] = ['guard', 'builder', 'hauler', 'farmer', 'miner', 'scout', 'merchant', 'free-agent'];
const VALID_AUTONOMY: AutonomyLevel[] = ['manual', 'assisted', 'autonomous'];
const DEBOUNCE_MS = 1_000;

export interface OverrideRecord {
  reason: string;
  commandId: string;
  at: number;
}

const OVERRIDE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

export class RoleManager {
  private assignments: RoleAssignmentRecord[] = [];
  private overrides: Map<string, OverrideRecord> = new Map();
  private readonly filePath: string;
  private readonly io: SocketIOServer;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.filePath = path.join(process.cwd(), 'data', 'roles.json');
    this.load();
  }

  // ── Manual Override Tracking ──────────────────────────────

  setOverride(botName: string, reason: string, commandId: string): void {
    this.overrides.set(botName, { reason, commandId, at: Date.now() });
    this.io.emit(FLEET_EVENTS.ROLE_UPDATED, { assignments: this.assignments, overrides: this.getOverrides() });
    logger.info({ botName, reason, commandId }, 'RoleManager: override set');
  }

  clearOverride(botName: string): void {
    if (this.overrides.delete(botName)) {
      this.io.emit(FLEET_EVENTS.ROLE_UPDATED, { assignments: this.assignments, overrides: this.getOverrides() });
      logger.info({ botName }, 'RoleManager: override cleared');
    }
  }

  getOverride(botName: string): OverrideRecord | null {
    return this.overrides.get(botName) || null;
  }

  isOverridden(botName: string): boolean {
    return this.overrides.has(botName);
  }

  getOverrides(): Record<string, OverrideRecord> {
    return Object.fromEntries(this.overrides);
  }

  /** Clear overrides older than 5 minutes. Call this periodically. */
  checkOverrideTimeouts(): void {
    const now = Date.now();
    let changed = false;
    for (const [botName, record] of this.overrides) {
      if (now - record.at > OVERRIDE_EXPIRY_MS) {
        this.overrides.delete(botName);
        logger.info({ botName, ageMs: now - record.at }, 'RoleManager: override expired');
        changed = true;
      }
    }
    if (changed) {
      this.io.emit(FLEET_EVENTS.ROLE_UPDATED, { assignments: this.assignments, overrides: this.getOverrides() });
    }
  }

  // ── Persistence ──────────────────────────────────────────

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        logger.warn('roles.json is corrupt (not an array), starting empty');
        this.assignments = [];
        return;
      }

      this.assignments = parsed;
      logger.info({ count: this.assignments.length }, 'RoleManager: loaded assignments');
    } catch (err) {
      logger.warn({ err }, 'RoleManager: failed to load roles.json, starting empty');
      this.assignments = [];
    }
  }

  /** Schedule a debounced save */
  private save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveImmediate();
    }, DEBOUNCE_MS);
  }

  /** Write to disk immediately */
  private saveImmediate(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.assignments, null, 2));
    } catch (err) {
      logger.error({ err }, 'RoleManager: failed to save roles.json');
    }
  }

  /** Flush pending saves and clear timers */
  shutdown(): void {
    this.saveImmediate();
  }

  private generateId(): string {
    return `role_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private emit(): void {
    this.io.emit(FLEET_EVENTS.ROLE_UPDATED, { assignments: this.assignments });
  }

  // ── CRUD ─────────────────────────────────────────────────

  createAssignment(data: {
    botName: string;
    role: RoleType;
    autonomyLevel: AutonomyLevel;
    homeMarkerId?: string;
    allowedZoneIds?: string[];
    preferredMissionTypes?: string[];
  }): RoleAssignmentRecord {
    // Validate role
    if (!VALID_ROLES.includes(data.role)) {
      throw new Error(`Invalid role: ${data.role}`);
    }
    // Validate autonomy level
    if (!VALID_AUTONOMY.includes(data.autonomyLevel)) {
      throw new Error(`Invalid autonomy level: ${data.autonomyLevel}`);
    }

    // Replace existing assignment for the same bot
    const existing = this.assignments.findIndex((a) => a.botName === data.botName);
    if (existing !== -1) {
      logger.warn(
        { assignmentId: this.assignments[existing].id, botName: data.botName, role: this.assignments[existing].role, action: 'replace' },
        'RoleManager: replacing existing role assignment for bot',
      );
      this.assignments.splice(existing, 1);
    }

    const record: RoleAssignmentRecord = {
      id: this.generateId(),
      botName: data.botName,
      role: data.role,
      autonomyLevel: data.autonomyLevel,
      homeMarkerId: data.homeMarkerId,
      allowedZoneIds: data.allowedZoneIds ?? [],
      preferredMissionTypes: data.preferredMissionTypes ?? [],
    };

    this.assignments.push(record);
    this.save();
    this.emit();
    logger.info({ assignmentId: record.id, botName: record.botName, role: record.role, action: 'create' }, 'RoleManager: assignment created');
    return record;
  }

  getAssignments(): RoleAssignmentRecord[] {
    return this.assignments;
  }

  getAssignment(id: string): RoleAssignmentRecord | null {
    return this.assignments.find((a) => a.id === id) ?? null;
  }

  getAssignmentForBot(botName: string): RoleAssignmentRecord | null {
    return this.assignments.find((a) => a.botName === botName) ?? null;
  }

  updateAssignment(id: string, data: Partial<RoleAssignmentRecord>): RoleAssignmentRecord | null {
    const idx = this.assignments.findIndex((a) => a.id === id);
    if (idx === -1) return null;

    // Validate role if provided
    if (data.role && !VALID_ROLES.includes(data.role)) {
      throw new Error(`Invalid role: ${data.role}`);
    }
    // Validate autonomy level if provided
    if (data.autonomyLevel && !VALID_AUTONOMY.includes(data.autonomyLevel)) {
      throw new Error(`Invalid autonomy level: ${data.autonomyLevel}`);
    }

    // Don't allow changing id
    const { id: _ignoreId, ...updateFields } = data;
    this.assignments[idx] = { ...this.assignments[idx], ...updateFields };

    this.save();
    this.emit();
    logger.info(
      { assignmentId: id, botName: this.assignments[idx].botName, role: this.assignments[idx].role, action: 'update' },
      'RoleManager: assignment updated',
    );
    return this.assignments[idx];
  }

  deleteAssignment(id: string): boolean {
    const idx = this.assignments.findIndex((a) => a.id === id);
    if (idx === -1) return false;

    const removed = this.assignments.splice(idx, 1)[0];
    this.save();
    this.emit();
    logger.info({ assignmentId: id, botName: removed.botName, role: removed.role, action: 'delete' }, 'RoleManager: assignment deleted');
    return true;
  }
}
