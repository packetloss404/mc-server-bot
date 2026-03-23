import { Server as SocketIOServer } from 'socket.io';
import { RoleAssignmentRecord, RoleType, AutonomyLevel, FLEET_EVENTS } from './FleetTypes';
import { logger } from '../util/logger';
import * as fs from 'fs';
import * as path from 'path';

const VALID_ROLES: RoleType[] = ['guard', 'builder', 'hauler', 'farmer', 'miner', 'scout', 'merchant', 'free-agent'];
const VALID_AUTONOMY: AutonomyLevel[] = ['manual', 'assisted', 'autonomous'];

export class RoleManager {
  private assignments: RoleAssignmentRecord[] = [];
  private readonly filePath: string;
  private readonly io: SocketIOServer;

  constructor(io: SocketIOServer) {
    this.io = io;
    this.filePath = path.join(process.cwd(), 'data', 'roles.json');
    this.load();
  }

  // ── Persistence ──────────────────────────────────────────

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.assignments = JSON.parse(raw);
        logger.info({ count: this.assignments.length }, 'RoleManager: loaded assignments');
      }
    } catch (err) {
      logger.warn({ err }, 'RoleManager: failed to load roles.json, starting empty');
      this.assignments = [];
    }
  }

  private save(): void {
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
        { botName: data.botName, oldRole: this.assignments[existing].role, newRole: data.role },
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
    logger.info({ id: record.id, botName: record.botName, role: record.role }, 'RoleManager: assignment created');
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
    logger.info({ id, updates: Object.keys(updateFields) }, 'RoleManager: assignment updated');
    return this.assignments[idx];
  }

  deleteAssignment(id: string): boolean {
    const idx = this.assignments.findIndex((a) => a.id === id);
    if (idx === -1) return false;

    const removed = this.assignments.splice(idx, 1)[0];
    this.save();
    this.emit();
    logger.info({ id, botName: removed.botName }, 'RoleManager: assignment deleted');
    return true;
  }
}
