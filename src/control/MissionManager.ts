/* ── MissionManager: mission lifecycle with queues and dependencies ── */

import { randomUUID } from 'crypto';
import {
  Mission,
  MissionCreateParams,
  MissionQueue,
  MissionStatus,
} from './MissionTypes';
import { RoleManager } from './RoleManager';

export class MissionManager {
  private missions: Map<string, Mission> = new Map();
  private queues: Map<string, MissionQueue> = new Map();
  private roleManager: RoleManager | null = null;

  setRoleManager(rm: RoleManager): void {
    this.roleManager = rm;
  }

  /* ── CRUD ── */

  create(params: MissionCreateParams): Mission {
    const id = randomUUID();
    const now = Date.now();
    const mission: Mission = {
      id,
      name: params.name,
      description: params.description,
      botName: params.botName,
      status: 'pending',
      priority: params.priority ?? 'normal',
      steps: (params.steps ?? []).map((s) => ({ description: s.description, status: 'pending' })),
      currentStepIndex: 0,
      dependencies: params.dependencies ?? [],
      source: params.source ?? 'api',
      createdAt: now,
      updatedAt: now,
      requiresApproval: params.requiresApproval ?? false,
      approved: !params.requiresApproval,
      retriesLeft: params.retriesLeft ?? 0,
      templateId: params.templateId,
    };

    this.missions.set(id, mission);
    this.enqueue(mission.botName, id);
    return mission;
  }

  get(missionId: string): Mission | undefined {
    return this.missions.get(missionId);
  }

  list(): Mission[] {
    return [...this.missions.values()];
  }

  /** Get the currently running mission for a bot (if any) */
  getActiveMissionForBot(botName: string): Mission | undefined {
    for (const m of this.missions.values()) {
      if (m.botName === botName && m.status === 'running') return m;
    }
    return undefined;
  }

  /* ── Lifecycle ── */

  start(missionId: string): Mission | undefined {
    const m = this.missions.get(missionId);
    if (!m || m.status !== 'pending') return undefined;

    // Check dependencies
    for (const depId of m.dependencies) {
      const dep = this.missions.get(depId);
      if (!dep || dep.status !== 'completed') {
        m.error = `Dependency ${depId} not completed`;
        return undefined;
      }
    }

    // Check approval requirement
    if (m.requiresApproval && !m.approved) {
      m.error = 'Mission requires approval before starting';
      return undefined;
    }

    // Check override block
    if (this.roleManager) {
      const assignment = this.roleManager.getByBot(m.botName);
      if (assignment?.manualOverride) {
        const now = Date.now();
        if (!assignment.overrideExpiresAt || assignment.overrideExpiresAt > now) {
          m.error = 'Bot is under manual override';
          return undefined;
        }
      }
    }

    m.status = 'running';
    m.startedAt = Date.now();
    m.updatedAt = Date.now();
    if (m.steps.length > 0) {
      m.steps[0].status = 'running';
      m.steps[0].startedAt = Date.now();
    }
    return m;
  }

  approve(missionId: string): boolean {
    const m = this.missions.get(missionId);
    if (!m) return false;
    m.approved = true;
    m.updatedAt = Date.now();
    return true;
  }

  pause(missionId: string): boolean {
    const m = this.missions.get(missionId);
    if (!m || m.status !== 'running') return false;
    m.status = 'paused';
    m.updatedAt = Date.now();
    return true;
  }

  resume(missionId: string): boolean {
    const m = this.missions.get(missionId);
    if (!m || m.status !== 'paused') return false;
    m.status = 'running';
    m.updatedAt = Date.now();
    return true;
  }

  cancel(missionId: string): boolean {
    const m = this.missions.get(missionId);
    if (!m) return false;
    if (m.status === 'completed' || m.status === 'cancelled') return false;
    m.status = 'cancelled';
    m.updatedAt = Date.now();
    return true;
  }

  complete(missionId: string): boolean {
    const m = this.missions.get(missionId);
    if (!m || m.status !== 'running') return false;
    m.status = 'completed';
    m.completedAt = Date.now();
    m.updatedAt = Date.now();
    return true;
  }

  fail(missionId: string, error: string): boolean {
    const m = this.missions.get(missionId);
    if (!m || m.status !== 'running') return false;
    m.status = 'failed';
    m.error = error;
    m.updatedAt = Date.now();
    return true;
  }

  retry(missionId: string): boolean {
    const m = this.missions.get(missionId);
    if (!m || (m.status !== 'failed' && m.status !== 'blocked')) return false;
    if (m.retriesLeft <= 0) return false;
    m.retriesLeft--;
    m.status = 'pending';
    m.error = undefined;
    m.updatedAt = Date.now();
    return true;
  }

  /** Advance the current step to completed and move to the next */
  advanceStep(missionId: string): boolean {
    const m = this.missions.get(missionId);
    if (!m || m.status !== 'running') return false;
    const idx = m.currentStepIndex;
    if (idx >= m.steps.length) return false;

    m.steps[idx].status = 'completed';
    m.steps[idx].completedAt = Date.now();
    m.currentStepIndex++;

    if (m.currentStepIndex >= m.steps.length) {
      // All steps done
      m.status = 'completed';
      m.completedAt = Date.now();
    } else {
      m.steps[m.currentStepIndex].status = 'running';
      m.steps[m.currentStepIndex].startedAt = Date.now();
    }
    m.updatedAt = Date.now();
    return true;
  }

  /* ── Queue management ── */

  getQueue(botName: string): MissionQueue {
    if (!this.queues.has(botName)) {
      this.queues.set(botName, { botName, missions: [] });
    }
    return this.queues.get(botName)!;
  }

  private enqueue(botName: string, missionId: string): void {
    const q = this.getQueue(botName);
    q.missions.push(missionId);
    this.sortQueue(botName);
  }

  reorderQueue(botName: string, missionIds: string[]): void {
    const q = this.getQueue(botName);
    q.missions = missionIds.filter((id) => this.missions.has(id));
  }

  clearQueue(botName: string): string[] {
    const q = this.getQueue(botName);
    const removed = [...q.missions];
    q.missions = [];
    return removed;
  }

  private sortQueue(botName: string): void {
    const q = this.getQueue(botName);
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
    q.missions.sort((a, b) => {
      const ma = this.missions.get(a);
      const mb = this.missions.get(b);
      if (!ma || !mb) return 0;
      return (priorityOrder[ma.priority] ?? 2) - (priorityOrder[mb.priority] ?? 2);
    });
  }

  /** Detect missions that have been running too long without progress */
  detectStale(maxAgeMs: number): Mission[] {
    const now = Date.now();
    const stale: Mission[] = [];
    for (const m of this.missions.values()) {
      if (m.status === 'running' && m.updatedAt + maxAgeMs < now) {
        stale.push(m);
      }
    }
    return stale;
  }

  /* ── Persistence ── */

  toJSON(): { missions: Mission[]; queues: MissionQueue[] } {
    return {
      missions: [...this.missions.values()],
      queues: [...this.queues.values()],
    };
  }

  loadFrom(data: { missions: Mission[]; queues: MissionQueue[] }): void {
    this.missions.clear();
    this.queues.clear();
    for (const m of data.missions) this.missions.set(m.id, m);
    for (const q of data.queues) this.queues.set(q.botName, q);
  }

  /**
   * Check whether auto-generation of missions/tasks is allowed for a bot,
   * consulting the RoleManager for override and autonomy state.
   */
  canAutoGenerate(botName: string): boolean {
    if (!this.roleManager) return true;
    const assignment = this.roleManager.getByBot(botName);
    if (!assignment) return true;

    // Manual override blocks auto-generation
    if (assignment.manualOverride) {
      const now = Date.now();
      if (!assignment.overrideExpiresAt || assignment.overrideExpiresAt > now) {
        return false;
      }
    }

    // Manual autonomy blocks auto-generation
    if (assignment.autonomy === 'manual') return false;
    return true;
  }
}
