import fs from 'fs';
import path from 'path';
import { LLMClient } from '../ai/LLMClient';
import { logger } from '../util/logger';

const DATA_DIR = './data';
const HISTORY_FILE = path.join(DATA_DIR, 'commander-history.json');
const SAVE_DEBOUNCE_MS = 2000;
const MAX_HISTORY = 100;

// Confidence threshold below which clarification is required
const CLARIFICATION_THRESHOLD = 0.5;

// ── Types ────────────────────────────────────────────────

export interface ClarificationQuestion {
  id: string;
  question: string;
  options: string[];
  field: string; // which part of the plan this clarifies (e.g. "targets", "zone", "action")
}

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
  clarificationQuestions: ClarificationQuestion[];
  needsClarification: boolean;
  suggestedCommands: string[];
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
  status: 'parsed' | 'executed' | 'partial_failure' | 'clarification_needed';
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

  // ── Suggested commands ──────────────────────────────────

  private static SUGGESTED_COMMANDS = [
    'Send all guards to the village',
    'Have the farmer harvest wheat',
    'Pause all bots',
    'Move miners to the mine entrance',
    'Regroup all bots at base',
    'Send explorer to scout the north',
    'Have blacksmith craft iron tools',
    'Patrol the perimeter with guards',
  ];

  getSuggestedCommands(): string[] {
    const shuffled = [...CommanderService.SUGGESTED_COMMANDS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 4);
  }

  // ── Clarification generation ────────────────────────────

  private generateClarificationQuestions(
    input: string,
    confidence: number,
    warnings: string[],
  ): ClarificationQuestion[] {
    const questions: ClarificationQuestion[] = [];
    const lowerInput = input.toLowerCase();

    // Check for ambiguous bot references
    const vagueBotRefs = ['the bot', 'a bot', 'someone', 'one of them', 'it'];
    const hasVagueBotRef = vagueBotRefs.some((ref) => lowerInput.includes(ref));
    if (hasVagueBotRef) {
      questions.push({
        id: this.generateId('cq'),
        question: 'Which bot should perform this action?',
        options: ['All bots', 'Guards only', 'Farmers only', 'Miners only', 'Explorers only', 'Specify by name'],
        field: 'targets',
      });
    }

    // Check for ambiguous location references
    const vagueLocRefs = ['over there', 'that place', 'the area', 'nearby', 'somewhere'];
    const hasVagueLocation = vagueLocRefs.some((ref) => lowerInput.includes(ref));
    if (hasVagueLocation) {
      questions.push({
        id: this.generateId('cq'),
        question: 'Which location do you mean?',
        options: ['Base', 'Village', 'Mine entrance', 'Farm area', 'Use coordinates', 'Nearest marker'],
        field: 'location',
      });
    }

    // Check for ambiguous action when multiple interpretations exist
    const ambiguousPatterns: { pattern: RegExp; question: string; options: string[]; field: string }[] = [
      {
        pattern: /\b(go|move|head)\b/i,
        question: 'What should happen after reaching the destination?',
        options: ['Just move there', 'Move and guard the area', 'Move and start working', 'Move and patrol'],
        field: 'action',
      },
      {
        pattern: /\b(get|collect|gather)\b/i,
        question: 'How should the resources be handled?',
        options: ['Collect and store at base', 'Collect and hold in inventory', 'Collect a specific amount', 'Collect until full'],
        field: 'action',
      },
      {
        pattern: /\b(stop|halt|wait)\b/i,
        question: 'Should the bot remain idle or resume later?',
        options: ['Stop and remain idle', 'Pause temporarily (resume on next command)', 'Stop current task only'],
        field: 'action',
      },
    ];

    for (const { pattern, question, options, field } of ambiguousPatterns) {
      if (pattern.test(input) && confidence < 0.7) {
        questions.push({
          id: this.generateId('cq'),
          question,
          options,
          field,
        });
        break;
      }
    }

    // If there are warnings about missing data, add relevant questions
    for (const warning of warnings) {
      if (warning.toLowerCase().includes('zone') || warning.toLowerCase().includes('area')) {
        questions.push({
          id: this.generateId('cq'),
          question: 'Which zone should be used?',
          options: ['Guard zone', 'Farm zone', 'Build zone', 'Mine zone', 'Define a new zone'],
          field: 'zone',
        });
      }
      if (warning.toLowerCase().includes('bot') && !hasVagueBotRef) {
        questions.push({
          id: this.generateId('cq'),
          question: 'Which bot(s) should be involved?',
          options: ['All bots', 'Guards only', 'Farmers only', 'Miners only', 'Specify by name'],
          field: 'targets',
        });
      }
    }

    // Very low confidence -- ask the user what they mean generally
    if (confidence < 0.3 && questions.length === 0) {
      questions.push({
        id: this.generateId('cq'),
        question: 'Could you clarify what you want the bots to do?',
        options: [
          'Move bots to a location',
          'Start a task (mine, farm, build)',
          'Pause or stop bots',
          'Guard or patrol an area',
          'Manage squads and roles',
        ],
        field: 'intent',
      });
    }

    return questions;
  }

  // ── Parse ──────────────────────────────────────────────

  async parse(input: string): Promise<CommanderPlan> {
    const planId = this.generateId();
    const now = new Date().toISOString();
    const trimmedInput = input.trim();

    // Handle empty or very short input
    if (!trimmedInput || trimmedInput.length < 3) {
      const plan: CommanderPlan = {
        id: planId,
        input: trimmedInput,
        intent: '',
        confidence: 0,
        warnings: ['Input is too short or empty. Try a specific command.'],
        requiresConfirmation: false,
        commands: [],
        missions: [],
        clarificationQuestions: [],
        needsClarification: true,
        suggestedCommands: this.getSuggestedCommands(),
        createdAt: now,
      };
      this.plans.set(planId, plan);
      this.upsertHistory({ planId, input, plan, status: 'clarification_needed', createdAt: now });
      return plan;
    }

    // Derive intent and confidence heuristically
    let intent = '';
    let confidence = 0;
    const warnings: string[] = [];
    const commands: CommanderPlanCommand[] = [];
    const missions: CommanderPlanMission[] = [];

    const lowerInput = trimmedInput.toLowerCase();

    if (/\b(pause|stop|halt)\b/.test(lowerInput)) {
      intent = 'pause_bots';
      confidence = 0.7;
    } else if (/\b(resume|unpause|continue)\b/.test(lowerInput)) {
      intent = 'resume_bots';
      confidence = 0.7;
    } else if (/\b(move|go|walk|send|head)\b/.test(lowerInput)) {
      intent = 'move_bots';
      confidence = 0.5;
    } else if (/\b(mine|dig|excavate)\b/.test(lowerInput)) {
      intent = 'mine_task';
      confidence = 0.55;
    } else if (/\b(farm|harvest|plant)\b/.test(lowerInput)) {
      intent = 'farm_task';
      confidence = 0.55;
    } else if (/\b(guard|protect|defend)\b/.test(lowerInput)) {
      intent = 'guard_zone';
      confidence = 0.5;
    } else if (/\b(patrol|scout|explore)\b/.test(lowerInput)) {
      intent = 'patrol_route';
      confidence = 0.5;
    } else if (/\b(craft|build|make)\b/.test(lowerInput)) {
      intent = 'craft_task';
      confidence = 0.45;
    } else if (/\b(follow|accompany)\b/.test(lowerInput)) {
      intent = 'follow_player';
      confidence = 0.6;
    } else if (/\b(regroup|gather|rally)\b/.test(lowerInput)) {
      intent = 'regroup';
      confidence = 0.6;
    } else {
      intent = 'unknown';
      confidence = 0.15;
      warnings.push('Could not determine the intended action from the input.');
    }

    // Check for specificity
    const hasNamedBot = /\b(ada|bob|carl|dan|eve|fay)\b/i.test(lowerInput);
    const hasAllBots = /\ball\b/.test(lowerInput);
    const hasRole = /\b(guard|farmer|miner|explorer|blacksmith|merchant)\b/i.test(lowerInput);
    const hasCoords = /\b-?\d+\s*,?\s*-?\d+\b/.test(lowerInput);

    if (hasNamedBot || hasAllBots || hasRole) {
      confidence = Math.min(1, confidence + 0.15);
    } else if (intent !== 'unknown') {
      warnings.push('No specific bot or role targeted -- command may be ambiguous.');
      confidence = Math.max(0, confidence - 0.1);
    }

    if (hasCoords) {
      confidence = Math.min(1, confidence + 0.1);
    }

    if (!hasNamedBot && !hasAllBots && !hasRole && intent !== 'unknown') {
      warnings.push('Consider specifying which bots or roles should be targeted.');
    }

    // Determine if clarification is needed
    const clarificationQuestions = this.generateClarificationQuestions(trimmedInput, confidence, warnings);
    const needsClarification = confidence < CLARIFICATION_THRESHOLD || clarificationQuestions.length > 0;
    const suggestedCommands = confidence < CLARIFICATION_THRESHOLD ? this.getSuggestedCommands() : [];

    const plan: CommanderPlan = {
      id: planId,
      input: trimmedInput,
      intent,
      confidence,
      warnings,
      requiresConfirmation: confidence < 0.8 || warnings.length > 0,
      commands,
      missions,
      clarificationQuestions,
      needsClarification,
      suggestedCommands,
      createdAt: now,
    };

    this.plans.set(planId, plan);
    this.upsertHistory({
      planId,
      input,
      plan,
      status: needsClarification ? 'clarification_needed' : 'parsed',
      createdAt: now,
    });
    return plan;
  }

  // ── Re-parse with clarification ─────────────────────────

  async parseWithClarification(
    originalInput: string,
    clarifications: Record<string, string>,
  ): Promise<CommanderPlan> {
    const clarificationSuffix = Object.entries(clarifications)
      .map(([field, answer]) => `[${field}: ${answer}]`)
      .join(' ');

    const augmentedInput = `${originalInput} ${clarificationSuffix}`;
    logger.info({ originalInput, clarifications, augmentedInput }, 'Re-parsing with clarification');

    return this.parse(augmentedInput);
  }

  // ── Execute ──────────────────────────────────────────────

  async execute(planId: string): Promise<CommanderExecuteResult | null> {
    const plan = this.plans.get(planId);
    if (!plan) return null;

    // Block execution if clarification is still needed
    if (plan.needsClarification && plan.clarificationQuestions.length > 0) {
      logger.warn({ planId }, 'Cannot execute plan that still requires clarification');
      return null;
    }

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
