import fs from 'fs';
import path from 'path';
import { LLMClient } from '../ai/LLMClient';
import { logger } from '../util/logger';

const DATA_DIR = './data';
const HISTORY_FILE = path.join(DATA_DIR, 'commander-history.json');
const SAVE_DEBOUNCE_MS = 2000;
const MAX_HISTORY = 100;

// ── Types ────────────────────────────────────────────────

export interface CommanderPlanCommand {
  type: string;
  targets: string[];
  payload: Record<string, unknown>;
}

export interface CommanderPlanMission {
  type: string;
  title: string;
  description?: string;
  assigneeIds: string[];
}

export interface CommanderPlan {
  id: string;
  input: string;
  intent: string;
  confidence: number;
  warnings: string[];
  requiresConfirmation: boolean;
  commands: CommanderPlanCommand[];
  missions: CommanderPlanMission[];
  createdAt: string;
}

export interface CommanderExecuteResult {
  commands: unknown[];
  missions: unknown[];
}

export interface CommanderHistoryEntry {
  planId: string;
  input: string;
  plan: CommanderPlan;
  result?: CommanderExecuteResult;
  status: 'parsed' | 'executed' | 'partial_failure';
  createdAt: string;
  executedAt?: string;
}

export interface CommanderDraft {
  id: string;
  input: string;
  plan?: CommanderPlan;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommanderServiceDeps {
  llmClient: LLMClient | null;
}

// ── Service ──────────────────────────────────────────────

export class CommanderService {
  private llmClient: LLMClient | null;
  private plans: Map<string, CommanderPlan> = new Map();
  private history: CommanderHistoryEntry[] = [];
  private drafts: CommanderDraft[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: CommanderServiceDeps) {
    this.llmClient = deps.llmClient;
    this.load();
  }

  // ── Plan ID generation ──────────────────────────────────

  private generateId(prefix = 'plan'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // ── History ─────────────────────────────────────────────

  getHistory(limit = 20): CommanderHistoryEntry[] {
    return this.history.slice(0, limit);
  }

  upsertHistory(entry: CommanderHistoryEntry): void {
    this.history = [entry, ...this.history.filter((item) => item.planId !== entry.planId)].slice(0, MAX_HISTORY);
    this.scheduleSave();
  }

  // ── Drafts ──────────────────────────────────────────────

  getDrafts(): CommanderDraft[] {
    return [...this.drafts];
  }

  saveDraft(data: { input: string; plan?: CommanderPlan; notes?: string; id?: string }): CommanderDraft {
    const now = new Date().toISOString();

    // Update existing draft if id provided
    if (data.id) {
      const existing = this.drafts.find((d) => d.id === data.id);
      if (existing) {
        existing.input = data.input;
        if (data.plan !== undefined) existing.plan = data.plan;
        if (data.notes !== undefined) existing.notes = data.notes;
        existing.updatedAt = now;
        this.scheduleSave();
        logger.info({ draftId: existing.id }, 'Commander draft updated');
        return existing;
      }
    }

    // Create new draft
    const draft: CommanderDraft = {
      id: this.generateId('draft'),
      input: data.input,
      plan: data.plan,
      notes: data.notes,
      createdAt: now,
      updatedAt: now,
    };
    this.drafts.push(draft);
    this.scheduleSave();
    logger.info({ draftId: draft.id }, 'Commander draft saved');
    return draft;
  }

  deleteDraft(id: string): boolean {
    const idx = this.drafts.findIndex((d) => d.id === id);
    if (idx === -1) return false;
    this.drafts.splice(idx, 1);
    this.scheduleSave();
    logger.info({ draftId: id }, 'Commander draft deleted');
    return true;
  }

  // ── Plan storage ────────────────────────────────────────

  getPlan(planId: string): CommanderPlan | undefined {
    return this.plans.get(planId);
  }

  storePlan(plan: CommanderPlan): void {
    this.plans.set(plan.id, plan);
  }

  // ── Parse (stub - requires full control platform deps) ──

  async parse(input: string): Promise<CommanderPlan> {
    const planId = this.generateId();
    const now = new Date().toISOString();

    const plan: CommanderPlan = {
      id: planId,
      input,
      intent: '',
      confidence: 0,
      warnings: ['Commander parsing requires full control platform'],
      requiresConfirmation: true,
      commands: [],
      missions: [],
      createdAt: now,
    };

    this.plans.set(planId, plan);
    this.upsertHistory({ planId, input, plan, status: 'parsed', createdAt: now });
    return plan;
  }

  // ── Execute (stub) ──────────────────────────────────────

  async execute(planId: string): Promise<CommanderExecuteResult | null> {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    const result: CommanderExecuteResult = { commands: [], missions: [] };
    this.upsertHistory({
      planId,
      input: plan.input,
      plan,
      result,
      status: 'executed',
      createdAt: plan.createdAt,
      executedAt: new Date().toISOString(),
    });
    return result;
  }

  // ── Persistence ─────────────────────────────────────────

  private load(): void {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
        const data = JSON.parse(raw) as {
          history?: CommanderHistoryEntry[];
          drafts?: CommanderDraft[];
        };

        if (Array.isArray(data.history)) {
          this.history = data.history.slice(0, MAX_HISTORY);
        }
        if (Array.isArray(data.drafts)) {
          this.drafts = data.drafts;
        }

        // Rebuild plans map from history for continuity
        for (const entry of this.history) {
          if (entry.plan?.id) {
            this.plans.set(entry.plan.id, entry.plan);
          }
        }

        logger.info(
          { historyCount: this.history.length, draftCount: this.drafts.length },
          'Loaded commander history from disk',
        );
      }
    } catch (err: any) {
      logger.warn({ err }, 'Failed to load commander history file, starting fresh');
    }
  }

  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const data = {
        history: this.history,
        drafts: this.drafts,
      };
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err: any) {
      logger.error({ err }, 'Failed to save commander history file');
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => {
      this.save();
      this.saveTimer = null;
    }, SAVE_DEBOUNCE_MS);
  }

  /** Flush pending saves to disk immediately (call on process exit). */
  shutdown(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
    logger.info('Commander service shut down, history flushed to disk');
  }
}
