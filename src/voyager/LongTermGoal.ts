import { Task } from './CurriculumAgent';
import { inferTaskSpec, TaskSpec } from './TaskSpec';
import { Blueprint } from './Blueprint';

export type LongTermGoalKind =
  | 'gather_resource'
  | 'craft_item'
  | 'build_structure'
  | 'establish_farm'
  | 'travel_to_location'
  | 'general_project';

export interface LongTermGoalSpec {
  kind: LongTermGoalKind;
  target?: string;
  count?: number;
  locationHint?: string;
}

export interface LongTermGoal {
  id: string;
  requestedBy: string;
  rawRequest: string;
  spec: LongTermGoalSpec;
  status: 'active' | 'completed' | 'blocked' | 'cancelled';
  buildState?: 'classified' | 'blueprint_pending' | 'blueprint_ready' | 'site_selection' | 'materials_planning' | 'gathering' | 'building' | 'verifying' | 'completed' | 'blocked' | 'cancelled';
  blueprint?: Blueprint;
  origin?: { x: number; y: number; z: number };
  materialRequirements?: Record<string, number>;
  lastResourceNoticeAt?: number;
  createdAt: number;
  updatedAt: number;
  completedSubtasks: string[];
  pendingSubtasks: Task[];
}

export function inferLongTermGoalSpec(description: string): LongTermGoalSpec {
  const spec = inferTaskSpec({ description, keywords: tokenize(description) });
  if (spec.kind === 'harvest') {
    return { kind: 'gather_resource', target: spec.target, count: spec.count };
  }
  if (spec.kind === 'craft' || spec.kind === 'smelt') {
    return { kind: 'craft_item', target: spec.target, count: spec.count };
  }
  if (spec.kind === 'movement') {
    return { kind: 'travel_to_location', target: spec.target, locationHint: spec.destination };
  }
  if (/house|hut|tower|bridge|wall|build/i.test(description)) {
    return { kind: 'build_structure', target: spec.target || 'structure' };
  }
  if (/farm|plant|crop/i.test(description)) {
    return { kind: 'establish_farm', target: spec.target || 'farm' };
  }
  return { kind: 'general_project', target: spec.target, count: spec.count };
}

function tokenize(description: string): string[] {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

export function goalSummary(goal: LongTermGoal): string {
  return `${goal.spec.kind}:${goal.rawRequest} (${goal.status})`;
}

export function makeLongTermGoal(description: string, requestedBy: string, subtasks: Task[]): LongTermGoal {
  const spec = inferLongTermGoalSpec(description);
  return {
    id: `ltg-${Date.now()}`,
    requestedBy,
    rawRequest: description,
    spec,
    status: 'active',
    buildState: spec.kind === 'build_structure' ? 'classified' : undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedSubtasks: [],
    pendingSubtasks: subtasks,
  };
}

export function isLikelyLongTermGoal(description: string): boolean {
  return /(build|start|set up|make me|create|gather enough|collect enough|gear up|prepare|establish)/i.test(description)
    && /(house|hut|tower|farm|base|gear|armor|iron|food|supplies|bridge|wall|watchtower)/i.test(description);
}

export function longTermGoalToTask(goal: LongTermGoal): Task | null {
  return goal.pendingSubtasks[0] || null;
}

export function popLongTermSubtask(goal: LongTermGoal): Task | null {
  const next = goal.pendingSubtasks.shift() || null;
  goal.updatedAt = Date.now();
  return next;
}

export function completeLongTermSubtask(goal: LongTermGoal, task: Task): void {
  goal.completedSubtasks.push(task.description);
  goal.updatedAt = Date.now();
  if (goal.pendingSubtasks.length === 0) {
    goal.status = 'completed';
  }
}
