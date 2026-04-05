/* ── RoutineManager: repeatable step sequences ── */

import { randomUUID } from 'crypto';
import { CommandCenter } from './CommandCenter';
import { CommandType, CommandPayload } from './CommandTypes';

export interface RoutineStep {
  commandType: CommandType;
  payload: CommandPayload;
  delayMs?: number;
}

export interface Routine {
  id: string;
  name: string;
  description: string;
  steps: RoutineStep[];
  createdAt: number;
  updatedAt: number;
}

export interface RoutineExecution {
  routineId: string;
  botName: string;
  stepsCompleted: number;
  totalSteps: number;
  errors: string[];
  startedAt: number;
  completedAt?: number;
}

export class RoutineManager {
  private routines: Map<string, Routine> = new Map();
  private commandCenter: CommandCenter | null = null;

  setCommandCenter(cc: CommandCenter): void {
    this.commandCenter = cc;
  }

  create(name: string, description: string, steps: RoutineStep[]): Routine {
    const id = randomUUID();
    const now = Date.now();
    const routine: Routine = { id, name, description, steps, createdAt: now, updatedAt: now };
    this.routines.set(id, routine);
    return routine;
  }

  get(routineId: string): Routine | undefined {
    return this.routines.get(routineId);
  }

  list(): Routine[] {
    return [...this.routines.values()];
  }

  update(routineId: string, patch: Partial<Pick<Routine, 'name' | 'description' | 'steps'>>): Routine | undefined {
    const r = this.routines.get(routineId);
    if (!r) return undefined;
    if (patch.name !== undefined) r.name = patch.name;
    if (patch.description !== undefined) r.description = patch.description;
    if (patch.steps !== undefined) r.steps = patch.steps;
    r.updatedAt = Date.now();
    return r;
  }

  delete(routineId: string): boolean {
    return this.routines.delete(routineId);
  }

  /**
   * Execute all steps of a routine on a given bot via the CommandCenter.
   * Returns an execution summary.
   */
  async execute(routineId: string, botName: string, source = 'routine'): Promise<RoutineExecution> {
    const routine = this.routines.get(routineId);
    if (!routine) {
      throw new Error(`Routine ${routineId} not found`);
    }
    if (!this.commandCenter) {
      throw new Error('CommandCenter not set');
    }

    const exec: RoutineExecution = {
      routineId,
      botName,
      stepsCompleted: 0,
      totalSteps: routine.steps.length,
      errors: [],
      startedAt: Date.now(),
    };

    for (const step of routine.steps) {
      if (step.delayMs && step.delayMs > 0) {
        await new Promise((r) => setTimeout(r, step.delayMs));
      }

      const cmd = await this.commandCenter.dispatch(
        step.commandType,
        botName,
        step.payload,
        source
      );

      if (cmd.status === 'completed') {
        exec.stepsCompleted++;
      } else {
        exec.errors.push(cmd.error || `Step failed with status ${cmd.status}`);
      }
    }

    exec.completedAt = Date.now();
    return exec;
  }

  toJSON(): Routine[] {
    return this.list();
  }

  loadFrom(routines: Routine[]): void {
    this.routines.clear();
    for (const r of routines) this.routines.set(r.id, r);
  }
}
