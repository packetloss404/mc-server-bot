import { Server as SocketIOServer } from 'socket.io';
import { RoleApprovalRequestRecord, RoleAssignmentRecord, RoleType, AutonomyLevel, FLEET_EVENTS } from './FleetTypes';
import type { MissionManager } from './MissionManager';
import type { MissionType } from './MissionTypes';
import { logger } from '../util/logger';
import { atomicWriteJsonSync } from '../util/atomicWrite';
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

export interface TaskAcceptanceVerdict {
  allowed: boolean;
  reason: string;
}

const OVERRIDE_EXPIRY_MS = 5 * 60 * 1000;
const APPROVAL_EXPIRY_MS = 5 * 60 * 1000;

export class RoleManager {
  private assignments: RoleAssignmentRecord[] = [];
  private overrides: Map<string, OverrideRecord> = new Map();
  private approvalRequests: RoleApprovalRequestRecord[] = [];
  private readonly filePath: string;
  private readonly io: SocketIOServer;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private overrideCheckInterval: ReturnType<typeof setInterval> | null = null;
  private automationInterval: ReturnType<typeof setInterval> | null = null;
  private missionManager: MissionManager | null = null;
  private lastGeneratedAt: Map<string, number> = new Map();

  constructor(io: SocketIOServer) {
    this.io = io;
    this.filePath = path.join(process.cwd(), 'data', 'roles.json');
    this.load();
    this.overrideCheckInterval = setInterval(() => this.checkOverrideTimeouts(), 30_000);
    this.automationInterval = setInterval(() => this.evaluateAutomation(), 60_000);
  }

  setMissionManager(missionManager: MissionManager): void {
    this.missionManager = missionManager;
    this.evaluateAutomation();
  }

  // -- Role Policy: Task Acceptance --

  shouldBotAcceptTask(botName: string): TaskAcceptanceVerdict {
    const assignment = this.getAssignmentForBot(botName);

    if (!assignment) {
      return { allowed: true, reason: 'No role assignment; bot operates as free agent' };
    }

    if (assignment.autonomyLevel === 'manual') {
      return {
        allowed: false,
        reason: `Bot "${botName}" has autonomy level "manual" (role: ${assignment.role}); auto-generated tasks are blocked`,
      };
    }

    if (this.isOverridden(botName)) {
      const override = this.getOverride(botName);
      return {
        allowed: false,
        reason: `Bot "${botName}" is under manual override (reason: ${override?.reason ?? 'unknown'}); auto-generated tasks are blocked`,
      };
    }

    if (assignment.loadoutPolicy) {
      this.checkLoadoutPolicy(botName, assignment);
    }

    return { allowed: true, reason: 'Role policy allows task acceptance' };
  }

  private checkLoadoutPolicy(botName: string, assignment: RoleAssignmentRecord): void {
    if (!assignment.loadoutPolicy) return;

    const requiredItems = assignment.loadoutPolicy.requiredItems as string[] | undefined;
    if (requiredItems && requiredItems.length > 0) {
      logger.warn(
        { botName, role: assignment.role, requiredItems },
        'RoleManager: loadout policy specifies required items -- loadout compliance not verified',
      );
    }

    const forbiddenItems = assignment.loadoutPolicy.forbiddenItems as string[] | undefined;
    if (forbiddenItems && forbiddenItems.length > 0) {
      logger.warn(
        { botName, role: assignment.role, forbiddenItems },
        'RoleManager: loadout policy specifies forbidden items -- loadout compliance not verified',
      );
    }
  }

  shouldAllowCommandDispatch(botName: string, force?: boolean): TaskAcceptanceVerdict {
    const assignment = this.getAssignmentForBot(botName);
    if (!assignment || !assignment.interruptPolicy) {
      return { allowed: true, reason: 'No interrupt policy configured' };
    }

    if (!this.missionManager) {
      return { allowed: true, reason: 'MissionManager not available; skipping interrupt policy check' };
    }

    const activeMissions = this.missionManager.getMissions({ bot: botName })
      .filter((m) => m.status === 'running');

    if (activeMissions.length === 0) {
      return { allowed: true, reason: 'Bot has no active missions' };
    }

    const hasCriticalMission = activeMissions.some(
      (m) => m.priority === 'urgent' || m.priority === 'high',
    );

    switch (assignment.interruptPolicy) {
      case 'never-while-critical':
        if (hasCriticalMission) {
          return {
            allowed: false,
            reason: `Bot "${botName}" has an active critical mission; interrupt policy "never-while-critical" blocks this command`,
          };
        }
        return { allowed: true, reason: 'No critical missions active; command allowed' };

      case 'confirm-if-busy':
        if (!force) {
          return {
            allowed: false,
            reason: `Bot "${botName}" is busy with an active mission; interrupt policy "confirm-if-busy" requires force:true to proceed`,
          };
        }
        return { allowed: true, reason: 'Command forced despite busy bot' };

      case 'always':
      default:
        return { allowed: true, reason: 'Interrupt policy allows commands at any time' };
    }
  }

  // -- Manual Override Tracking --

  setOverride(botName: string, reason: string, commandId: string): void {
    this.overrides.set(botName, { reason, commandId, at: Date.now() });
    this.emit();
    this.save();
    logger.info({ botName, reason, commandId }, 'RoleManager: override set');
  }

  clearOverride(botName: string): void {
    if (this.overrides.delete(botName)) {
      this.emit();
      this.save();
      logger.info({ botName }, 'RoleManager: override cleared');
      this.evaluateAutomation(botName);
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

  checkOverrideTimeouts(): void {
    const now = Date.now();
    let changed = false;
    for (const [botName, record] of this.overrides) {
      if (now - record.at > OVERRIDE_EXPIRY_MS) {
        this.overrides.delete(botName);
        logger.info({ botName, ageMs: now - record.at }, 'RoleManager: override expired');
        changed = true;
        this.evaluateAutomation(botName);
      }
    }
    for (const request of this.approvalRequests) {
      if (request.status === 'pending' && now > request.expiresAt) {
        request.status = 'expired';
        request.decidedAt = now;
        changed = true;
      }
    }
    if (changed) {
      this.emit();
      this.save();
    }
  }

  // -- Persistence --

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;

      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        this.assignments = parsed;
        this.approvalRequests = [];
      } else if (parsed && typeof parsed === 'object') {
        this.assignments = Array.isArray(parsed.assignments) ? parsed.assignments : [];
        this.approvalRequests = Array.isArray(parsed.approvalRequests) ? parsed.approvalRequests : [];
        if (parsed.overrides && typeof parsed.overrides === 'object') {
          this.overrides = new Map(Object.entries(parsed.overrides as Record<string, OverrideRecord>));
        }
      } else {
        logger.warn('roles.json is corrupt, starting empty');
        this.assignments = [];
        this.approvalRequests = [];
        return;
      }
      logger.info({ count: this.assignments.length }, 'RoleManager: loaded assignments');
    } catch (err) {
      logger.warn({ err }, 'RoleManager: failed to load roles.json, starting empty');
      this.assignments = [];
    }
  }

  private save(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveImmediate();
    }, DEBOUNCE_MS);
  }

  private saveImmediate(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    try {
      atomicWriteJsonSync(this.filePath, {
        assignments: this.assignments,
        approvalRequests: this.approvalRequests,
        overrides: this.getOverrides(),
      });
    } catch (err) {
      logger.error({ err }, 'RoleManager: failed to save roles.json');
    }
  }

  shutdown(): void {
    if (this.overrideCheckInterval) { clearInterval(this.overrideCheckInterval); this.overrideCheckInterval = null; }
    if (this.automationInterval) { clearInterval(this.automationInterval); this.automationInterval = null; }
    this.saveImmediate();
  }

  private getDefaultMissionType(assignment: RoleAssignmentRecord): MissionType | null {
    const preferred = assignment.preferredMissionTypes[0] as MissionType | undefined;
    if (preferred) return preferred;

    switch (assignment.role) {
      case 'guard':
        return 'patrol_zone';
      case 'builder':
      case 'hauler':
      case 'farmer':
      case 'miner':
      case 'scout':
      case 'merchant':
        return 'queue_task';
      case 'free-agent':
      default:
        return null;
    }
  }

  private getDefaultMissionTitle(assignment: RoleAssignmentRecord): string {
    switch (assignment.role) {
      case 'guard':
        return assignment.homeMarkerId ? `Guard ${assignment.homeMarkerId}` : `Guard assigned area`;
      case 'builder':
        return 'Maintain builder readiness';
      case 'hauler':
        return 'Maintain hauling readiness';
      case 'farmer':
        return 'Maintain farming readiness';
      case 'miner':
        return 'Maintain mining readiness';
      case 'scout':
        return 'Maintain scouting readiness';
      case 'merchant':
        return 'Maintain merchant readiness';
      default:
        return `Role automation for ${assignment.role}`;
    }
  }

  private buildMissionDraft(assignment: RoleAssignmentRecord): RoleApprovalRequestRecord['missionDraft'] | null {
    const missionType = this.getDefaultMissionType(assignment);
    if (!missionType) return null;

    const loadoutHint = assignment.loadoutPolicy ? ' Loadout policy configured.' : '';
    const zoneHint = assignment.allowedZoneIds.length > 0 ? ` Allowed zones: ${assignment.allowedZoneIds.join(', ')}.` : '';
    const description = assignment.homeMarkerId
      ? `Auto-generated ${assignment.role} mission near ${assignment.homeMarkerId}`
      : `Auto-generated ${assignment.role} mission`;

    return {
      type: missionType,
      title: this.getDefaultMissionTitle(assignment),
      description: `${description}.${zoneHint}${loadoutHint}`.trim(),
      assigneeType: 'bot',
      assigneeIds: [assignment.botName],
      priority: 'normal',
      source: 'role',
    };
  }

  private createApprovalRequest(assignment: RoleAssignmentRecord, missionDraft: RoleApprovalRequestRecord['missionDraft']): void {
    const existing = this.approvalRequests.find((request) => request.botName === assignment.botName && request.status === 'pending');
    if (existing) return;

    const now = Date.now();
    this.approvalRequests.unshift({
      id: `approval_${now}_${Math.random().toString(36).slice(2, 8)}`,
      assignmentId: assignment.id,
      assignmentUpdatedAt: assignment.updatedAt,
      botName: assignment.botName,
      role: assignment.role,
      status: 'pending',
      createdAt: now,
      expiresAt: now + APPROVAL_EXPIRY_MS,
      missionDraft,
    });
    this.approvalRequests = this.approvalRequests.slice(0, 100);
    this.emit();
    this.save();
  }

  private canReplaceActiveMission(assignment: RoleAssignmentRecord, activeMission: { priority: string; source: string; status: string } | undefined): boolean {
    if (!activeMission) return true;
    if (activeMission.source === 'role') return false;

    switch (assignment.interruptPolicy) {
      case 'always':
        return true;
      case 'never-while-critical':
        return !['running', 'paused'].includes(activeMission.status) && activeMission.priority !== 'urgent';
      case 'confirm-if-busy':
      default:
        return false;
    }
  }

  private handleInterruptibleMission(assignment: RoleAssignmentRecord, activeMission: { id: string; priority: string; source: string; status: string } | undefined): boolean {
    if (!activeMission) return true;
    if (activeMission.source === 'role') return false;
    if (assignment.interruptPolicy !== 'always') return false;
    if (!this.missionManager) return false;

    if (['queued', 'paused', 'draft'].includes(activeMission.status)) {
      this.missionManager.cancelMission(activeMission.id);
      logger.info({ botName: assignment.botName, interruptedMissionId: activeMission.id }, 'RoleManager: interrupted queued mission for role automation');
      return true;
    }

    return false;
  }

  evaluateAutomation(botName?: string): void {
    if (!this.missionManager) return;

    const candidates = botName
      ? this.assignments.filter((assignment) => assignment.botName === botName)
      : this.assignments;

    const now = Date.now();

    for (const assignment of candidates) {
      if (assignment.autonomyLevel === 'manual') continue;
      if (assignment.role === 'free-agent') continue;
      if (this.isOverridden(assignment.botName)) continue;

      const activeMissions = this.missionManager.getMissions({ bot: assignment.botName })
        .filter((mission) => ['draft', 'queued', 'running', 'paused'].includes(mission.status));
      const activeRoleMission = activeMissions.find((mission) => mission.source === 'role');
      if (activeRoleMission) continue;

      const activeNonRoleMission = activeMissions.find((mission) => mission.source !== 'role');
      if (activeNonRoleMission && !this.canReplaceActiveMission(assignment, activeNonRoleMission)) {
        const interrupted = this.handleInterruptibleMission(assignment, activeNonRoleMission);
        if (!interrupted) continue;
      }

      const lastGeneratedAt = this.lastGeneratedAt.get(assignment.botName) ?? 0;
      if (now - lastGeneratedAt < 60_000) continue;

      const missionDraft = this.buildMissionDraft(assignment);
      if (!missionDraft) continue;

      if (assignment.autonomyLevel === 'assisted') {
        this.createApprovalRequest(assignment, missionDraft);
        this.lastGeneratedAt.set(assignment.botName, now);
        logger.info({ botName: assignment.botName, role: assignment.role }, 'RoleManager: created assisted approval request');
        continue;
      }

      this.missionManager.createMission({
        ...missionDraft,
        type: missionDraft.type as MissionType,
      });
      this.lastGeneratedAt.set(assignment.botName, now);
      logger.info({ botName: assignment.botName, role: assignment.role, missionType: missionDraft.type }, 'RoleManager: auto-generated role mission');
    }
  }

  private generateId(): string {
    return `role_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private emit(record?: RoleAssignmentRecord): void {
    if (record) {
      this.io.emit(FLEET_EVENTS.ROLE_UPDATED, { ...record });
    } else {
      this.io.emit(FLEET_EVENTS.ROLE_UPDATED, null);
    }
  }

  getApprovalRequests(): RoleApprovalRequestRecord[] {
    return this.approvalRequests;
  }

  approveApprovalRequest(id: string, decidedBy?: string, decisionNote?: string): { approvalRequest: RoleApprovalRequestRecord; missionId: string } | null {
    if (!this.missionManager) return null;
    const request = this.approvalRequests.find((entry) => entry.id === id);
    if (!request || request.status !== 'pending') return null;
    const assignment = this.getAssignment(request.assignmentId);
    if (!assignment || assignment.updatedAt !== request.assignmentUpdatedAt || assignment.autonomyLevel !== 'assisted') {
      request.status = 'expired';
      request.decidedAt = Date.now();
      this.emit();
      this.save();
      return null;
    }
    const missionRecord = this.missionManager.createMission({
      ...request.missionDraft,
      type: request.missionDraft.type as MissionType,
    });
    request.status = 'approved';
    request.decidedAt = Date.now();
    request.decidedBy = decidedBy;
    request.decisionNote = decisionNote;
    this.emit();
    this.save();
    return { approvalRequest: request, missionId: missionRecord.id };
  }

  rejectApprovalRequest(id: string, decidedBy?: string, decisionNote?: string): RoleApprovalRequestRecord | null {
    const request = this.approvalRequests.find((entry) => entry.id === id);
    if (!request || request.status !== 'pending') return null;
    request.status = 'rejected';
    request.decidedAt = Date.now();
    request.decidedBy = decidedBy;
    request.decisionNote = decisionNote;
    this.emit();
    this.save();
    return request;
  }

  // -- CRUD --

  createAssignment(data: {
    botName: string;
    role: RoleType;
    autonomyLevel: AutonomyLevel;
    homeMarkerId?: string;
    allowedZoneIds?: string[];
    preferredMissionTypes?: string[];
    interruptPolicy?: RoleAssignmentRecord['interruptPolicy'];
    loadoutPolicy?: RoleAssignmentRecord['loadoutPolicy'];
  }): RoleAssignmentRecord {
    if (!VALID_ROLES.includes(data.role)) {
      throw new Error(`Invalid role: ${data.role}`);
    }
    if (!VALID_AUTONOMY.includes(data.autonomyLevel)) {
      throw new Error(`Invalid autonomy level: ${data.autonomyLevel}`);
    }

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
      interruptPolicy: data.interruptPolicy,
      loadoutPolicy: data.loadoutPolicy,
      updatedAt: Date.now(),
    };

    this.assignments.push(record);
    this.save();
    this.emit(record);
    this.evaluateAutomation(record.botName);
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

    if (data.role && !VALID_ROLES.includes(data.role)) {
      throw new Error(`Invalid role: ${data.role}`);
    }
    if (data.autonomyLevel && !VALID_AUTONOMY.includes(data.autonomyLevel)) {
      throw new Error(`Invalid autonomy level: ${data.autonomyLevel}`);
    }

    const { id: _ignoreId, ...updateFields } = data;
    this.assignments[idx] = { ...this.assignments[idx], ...updateFields, updatedAt: Date.now() };

    this.save();
    this.emit(this.assignments[idx]);
    this.evaluateAutomation(this.assignments[idx].botName);
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
    this.lastGeneratedAt.delete(removed.botName);
    logger.info({ assignmentId: id, botName: removed.botName, role: removed.role, action: 'delete' }, 'RoleManager: assignment deleted');
    return true;
  }
}
