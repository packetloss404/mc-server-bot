import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../util/logger';
import { BotManager } from '../bot/BotManager';

// -- Types --

export interface RoutineStep {
  type: 'command' | 'mission';
  data: Record<string, any>;
}

export interface Routine {
  id: string;
  name: string;
  description: string;
  steps: RoutineStep[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutineExecution {
  routineId: string;
  routineName: string;
  targetBots: string[];
  startedAt: string;
  stepsCompleted: number;
  totalSteps: number;
  status: 'running' | 'completed' | 'failed';
  error?: string;
}

interface RecordingSession {
  draft: Routine;
  startedBy: string;
}

function ensureDataDir(): string {
  const dir = path.join(process.cwd(), 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const ROUTINES_FILE = 'routines.json';

export class RoutineManager {
  private routines: Map<string, Routine> = new Map();
  private filePath: string;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private botManager: BotManager;
  private activeExecution: RoutineExecution | null = null;
  private recording: RecordingSession | null = null;

  constructor(botManager: BotManager) {
    this.botManager = botManager;
    const dir = ensureDataDir();
    this.filePath = path.join(dir, ROUTINES_FILE);
    this.load();
  }

  // -- Persistence --

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        const list: Routine[] = Array.isArray(raw) ? raw : raw.routines ?? [];
        for (const r of list) {
          this.routines.set(r.id, r);
        }
        logger.info({ count: this.routines.size }, 'Loaded routines from disk');
      }
    } catch (err: any) {
      logger.error({ err: err?.message }, 'Failed to load routines');
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.saveToDisk();
    }, 500);
  }

  private saveToDisk(): void {
    try {
      const list = Array.from(this.routines.values());
      fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err: any) {
      logger.error({ err: err?.message }, 'Failed to save routines');
    }
  }

  // -- CRUD --

  list(): Routine[] {
    return Array.from(this.routines.values());
  }

  get(id: string): Routine | undefined {
    return this.routines.get(id);
  }

  create(data: { name: string; description?: string; steps?: RoutineStep[] }): Routine {
    const now = new Date().toISOString();
    const routine: Routine = {
      id: randomUUID(),
      name: data.name,
      description: data.description ?? '',
      steps: data.steps ?? [],
      createdAt: now,
      updatedAt: now,
    };
    this.routines.set(routine.id, routine);
    this.scheduleSave();
    logger.info({ id: routine.id, name: routine.name }, 'Routine created');
    return routine;
  }

  update(id: string, patch: Partial<Pick<Routine, 'name' | 'description' | 'steps'>>): Routine | null {
    const existing = this.routines.get(id);
    if (!existing) return null;
    const updated: Routine = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    this.routines.set(id, updated);
    this.scheduleSave();
    logger.info({ id, name: updated.name }, 'Routine updated');
    return updated;
  }

  delete(id: string): boolean {
    const existed = this.routines.delete(id);
    if (existed) {
      this.scheduleSave();
      logger.info({ id }, 'Routine deleted');
    }
    return existed;
  }

  // -- Execution --

  getActiveExecution(): RoutineExecution | null {
    return this.activeExecution;
  }

  async execute(routineId: string, targetBotNames: string[]): Promise<RoutineExecution> {
    const routine = this.routines.get(routineId);
    if (!routine) {
      throw new Error(`Routine ${routineId} not found`);
    }

    if (routine.steps.length === 0) {
      throw new Error('Routine has no steps');
    }

    const bots = targetBotNames.map((name) => {
      const handle = this.botManager.getWorker(name);
      if (!handle) throw new Error(`Bot "${name}" not found`);
      return { name, handle };
    });

    if (bots.length === 0) {
      throw new Error('No target bots specified');
    }

    const execution: RoutineExecution = {
      routineId,
      routineName: routine.name,
      targetBots: targetBotNames,
      startedAt: new Date().toISOString(),
      stepsCompleted: 0,
      totalSteps: routine.steps.length,
      status: 'running',
    };
    this.activeExecution = execution;

    logger.info(
      { routineId, name: routine.name, bots: targetBotNames, steps: routine.steps.length },
      'Executing routine',
    );

    try {
      for (const step of routine.steps) {
        await this.executeStep(step, bots);
        execution.stepsCompleted++;
      }
      execution.status = 'completed';
      logger.info({ routineId, name: routine.name }, 'Routine execution completed');
    } catch (err: any) {
      execution.status = 'failed';
      execution.error = err?.message ?? String(err);
      logger.error({ routineId, err: execution.error }, 'Routine execution failed');
    }

    this.activeExecution = null;
    return execution;
  }

  private async executeStep(
    step: RoutineStep,
    bots: { name: string; handle: ReturnType<BotManager['getWorker']> }[],
  ): Promise<void> {
    for (const { name, handle } of bots) {
      if (!handle || !handle.isAlive()) {
        logger.warn({ bot: name }, 'Bot not alive, skipping step');
        continue;
      }

      if (step.type === 'command') {
        const cmd = step.data.command as string;
        const args = step.data.args ?? {};
        logger.info({ bot: name, command: cmd }, 'Dispatching command step');
        handle.sendCommand(cmd, args);
      } else if (step.type === 'mission') {
        const description = step.data.description as string;
        logger.info({ bot: name, task: description }, 'Queueing mission step');
        handle.sendCommand('queueTask', { description, source: 'routine' });
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // -- Recording --

  isRecording(): boolean {
    return this.recording !== null;
  }

  getRecordingDraft(): Routine | null {
    return this.recording?.draft ?? null;
  }

  startRecording(name: string, startedBy = 'dashboard'): Routine {
    if (this.recording) {
      throw new Error('Already recording a routine');
    }
    const now = new Date().toISOString();
    const draft: Routine = {
      id: randomUUID(),
      name,
      description: '',
      steps: [],
      createdAt: now,
      updatedAt: now,
    };
    this.recording = { draft, startedBy };
    logger.info({ name, id: draft.id }, 'Routine recording started');
    return draft;
  }

  captureStep(step: RoutineStep): void {
    if (!this.recording) return;
    this.recording.draft.steps.push(step);
    this.recording.draft.updatedAt = new Date().toISOString();
    logger.info(
      { routineId: this.recording.draft.id, stepCount: this.recording.draft.steps.length, type: step.type },
      'Step captured for recording',
    );
  }

  stopRecording(save: boolean): Routine | null {
    if (!this.recording) return null;
    const draft = this.recording.draft;
    this.recording = null;

    if (save && draft.steps.length > 0) {
      this.routines.set(draft.id, draft);
      this.scheduleSave();
      logger.info({ id: draft.id, name: draft.name, steps: draft.steps.length }, 'Recording saved as routine');
      return draft;
    }

    logger.info({ id: draft.id, save }, 'Recording stopped');
    return save ? draft : null;
  }
}
