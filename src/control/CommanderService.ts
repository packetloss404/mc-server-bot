import fs from 'fs';
import path from 'path';
import { LLMClient } from '../ai/LLMClient';
import { logger } from '../util/logger';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import type { CommandCenter, CreateCommandParams } from './CommandCenter';
import type { MissionManager, CreateMissionParams } from './MissionManager';
import type { CommandType } from './CommandTypes';
import type { MissionType } from './MissionTypes';

const DATA_DIR = path.join(process.cwd(), 'data');
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

export interface CommanderMetrics {
  totalParses: number;
  successfulParses: number;
  failedParses: number;
  totalExecutions: number;
  partialFailures: number;
  averageConfidence: number;
  clarificationRequestCount: number;
  mostUsedCommandTypes: Record<string, number>;
  mostUsedMissionTypes: Record<string, number>;
}

export interface CommanderServiceDeps {
  llmClient: LLMClient | null;
}

// ── Service ──────────────────────────────────────────────

export class CommanderService {
  private llmClient: LLMClient | null;
  private commandCenter: CommandCenter | null = null;
  private missionManager: MissionManager | null = null;
  private plans: Map<string, CommanderPlan> = new Map();
  private history: CommanderHistoryEntry[] = [];
  private drafts: CommanderDraft[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Metrics counters ───────────────────────────────────
  private totalParses = 0;
  private successfulParses = 0;
  private failedParses = 0;
  private totalExecutions = 0;
  private partialFailures = 0;
  private confidenceSum = 0;
  private clarificationRequestCount = 0;
  private commandTypeCounts: Record<string, number> = {};
  private missionTypeCounts: Record<string, number> = {};

  constructor(deps: CommanderServiceDeps) {
    this.llmClient = deps.llmClient;
    this.load();
  }

  setCommandCenter(cc: CommandCenter): void {
    this.commandCenter = cc;
  }

  setMissionManager(mm: MissionManager): void {
    this.missionManager = mm;
  }

  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
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

  // ── Metrics ────────────────────────────────────────────

  private trackParseMetrics(plan: CommanderPlan): void {
    this.totalParses++;
    this.confidenceSum += plan.confidence;

    if (plan.confidence > CLARIFICATION_THRESHOLD) {
      this.successfulParses++;
    } else {
      this.failedParses++;
    }

    if (plan.needsClarification) {
      this.clarificationRequestCount++;
    }

    if (plan.intent && plan.intent !== 'unknown') {
      this.commandTypeCounts[plan.intent] = (this.commandTypeCounts[plan.intent] || 0) + 1;
    }

    for (const cmd of plan.commands) {
      if (cmd.type) {
        this.commandTypeCounts[cmd.type] = (this.commandTypeCounts[cmd.type] || 0) + 1;
      }
    }

    for (const mission of plan.missions) {
      if (mission.type) {
        this.missionTypeCounts[mission.type] = (this.missionTypeCounts[mission.type] || 0) + 1;
      }
    }
  }

  private trackExecutionMetrics(result: CommanderExecuteResult): void {
    this.totalExecutions++;

    const hasCommandErrors = result.commands.some(
      (c: any) => c && (c.status === 'failed' || c.error),
    );
    const hasMissionErrors = result.missions.some(
      (m: any) => m && (m.status === 'failed' || m.error),
    );

    if (hasCommandErrors || hasMissionErrors) {
      this.partialFailures++;
    }
  }

  getMetrics(): CommanderMetrics {
    return {
      totalParses: this.totalParses,
      successfulParses: this.successfulParses,
      failedParses: this.failedParses,
      totalExecutions: this.totalExecutions,
      partialFailures: this.partialFailures,
      averageConfidence: this.totalParses > 0 ? this.confidenceSum / this.totalParses : 0,
      clarificationRequestCount: this.clarificationRequestCount,
      mostUsedCommandTypes: { ...this.commandTypeCounts },
      mostUsedMissionTypes: { ...this.missionTypeCounts },
    };
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
      this.trackParseMetrics(plan);
      return plan;
    }

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

    // ── Resolve targets ──────────────────────────────────
    const targets = this.resolveTargets(lowerInput, hasNamedBot, hasAllBots, hasRole);

    // ── Parse coordinates if present ─────────────────────
    const coordPayload: Record<string, unknown> = {};
    const coordMatch = lowerInput.match(/(-?\d+)\s*[, ]\s*(-?\d+)(?:\s*[, ]\s*(-?\d+))?/);
    if (coordMatch) {
      coordPayload.x = parseInt(coordMatch[1], 10);
      coordPayload.z = parseInt(coordMatch[2], 10);
      if (coordMatch[3] !== undefined) {
        coordPayload.y = parseInt(coordMatch[2], 10);
        coordPayload.z = parseInt(coordMatch[3], 10);
      }
    }

    // ── Populate commands and missions based on intent ────
    this.populateCommandsAndMissions(intent, targets, coordPayload, lowerInput, commands, missions);

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
    this.trackParseMetrics(plan);
    return plan;
  }

  // ── Target resolution ──────────────────────────────────

  private resolveTargets(
    lowerInput: string,
    hasNamedBot: boolean,
    hasAllBots: boolean,
    hasRole: boolean,
  ): string[] {
    if (hasAllBots) {
      return ['__all__'];
    }

    const targets: string[] = [];

    if (hasNamedBot) {
      const nameMatches = lowerInput.match(/\b(ada|bob|carl|dan|eve|fay)\b/gi);
      if (nameMatches) {
        for (const m of nameMatches) {
          const name = m.charAt(0).toUpperCase() + m.slice(1).toLowerCase();
          if (!targets.includes(name)) targets.push(name);
        }
      }
    }

    if (hasRole && targets.length === 0) {
      const roleMatch = lowerInput.match(/\b(guard|farmer|miner|explorer|blacksmith|merchant)s?\b/i);
      if (roleMatch) {
        targets.push(`__role:${roleMatch[1].toLowerCase()}__`);
      }
    }

    return targets;
  }

  // ── Map intents to commands / missions ─────────────────

  private static INTENT_TO_COMMAND_TYPE: Record<string, CommandType> = {
    pause_bots: 'pause_voyager',
    resume_bots: 'resume_voyager',
    move_bots: 'walk_to_coords',
    follow_player: 'follow_player',
    regroup: 'regroup',
    guard_zone: 'guard_zone',
    patrol_route: 'patrol_route',
  };

  private static INTENT_TO_MISSION_TYPE: Record<string, MissionType> = {
    mine_task: 'queue_task',
    farm_task: 'queue_task',
    craft_task: 'craft_items',
  };

  private populateCommandsAndMissions(
    intent: string,
    targets: string[],
    coordPayload: Record<string, unknown>,
    lowerInput: string,
    commands: CommanderPlanCommand[],
    missions: CommanderPlanMission[],
  ): void {
    if (intent === 'unknown' || targets.length === 0) return;

    const commandType = CommanderService.INTENT_TO_COMMAND_TYPE[intent];
    if (commandType) {
      const payload: Record<string, unknown> = { ...coordPayload };

      // Extract player name for follow_player
      if (commandType === 'follow_player') {
        const followMatch = lowerInput.match(/follow\s+(\w+)/i);
        if (followMatch && !['me', 'player'].includes(followMatch[1].toLowerCase())) {
          payload.playerName = followMatch[1];
        }
      }

      commands.push({ type: commandType, targets, payload });
      return;
    }

    const missionType = CommanderService.INTENT_TO_MISSION_TYPE[intent];
    if (missionType) {
      // Build a descriptive title from the intent
      const titleMap: Record<string, string> = {
        mine_task: 'Mine resources',
        farm_task: 'Farm crops',
        craft_task: 'Craft items',
      };
      const title = titleMap[intent] ?? intent;

      // Extract a more specific description from the input
      const description = lowerInput;

      missions.push({
        type: missionType,
        title,
        description,
        assigneeIds: targets,
      });
    }
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

    if (plan.needsClarification && plan.clarificationQuestions.length > 0) {
      logger.warn({ planId }, 'Cannot execute plan that still requires clarification');
      return null;
    }

    const result: CommanderExecuteResult = { commands: [], missions: [] };

    // ── Dispatch commands via CommandCenter ───────────────
    for (const cmd of plan.commands) {
      if (this.commandCenter) {
        try {
          const scope = cmd.targets.includes('__all__')
            ? 'all' as const
            : cmd.targets.length > 1
              ? 'selection' as const
              : 'single' as const;

          const createParams: CreateCommandParams = {
            type: cmd.type as CommandType,
            scope,
            source: 'commander',
            targets: cmd.targets,
            payload: cmd.payload,
          };

          const record = this.commandCenter.createCommand(createParams);
          const dispatched = await this.commandCenter.dispatchCommand(record);
          result.commands.push(dispatched);
          logger.info(
            { planId, commandId: record.id, type: cmd.type, targets: cmd.targets },
            'Commander dispatched command',
          );
        } catch (err: any) {
          const errorEntry = { type: cmd.type, targets: cmd.targets, error: String(err?.message ?? err) };
          result.commands.push(errorEntry);
          logger.error({ planId, cmd, err }, 'Commander failed to dispatch command');
        }
      } else {
        result.commands.push({ type: cmd.type, targets: cmd.targets, status: 'skipped', reason: 'no CommandCenter' });
        logger.warn({ planId, type: cmd.type }, 'CommandCenter not available, command skipped');
      }
    }

    // ── Create missions via MissionManager ───────────────
    for (const msn of plan.missions) {
      if (this.missionManager) {
        try {
          const createParams: CreateMissionParams = {
            type: msn.type as MissionType,
            title: msn.title,
            description: msn.description,
            assigneeType: 'bot',
            assigneeIds: msn.assigneeIds,
            source: 'commander',
          };

          const record = this.missionManager.createMission(createParams);
          result.missions.push(record);
          logger.info(
            { planId, missionId: record.id, type: msn.type, assignees: msn.assigneeIds },
            'Commander created mission',
          );
        } catch (err: any) {
          const errorEntry = { type: msn.type, title: msn.title, error: String(err?.message ?? err) };
          result.missions.push(errorEntry);
          logger.error({ planId, msn, err }, 'Commander failed to create mission');
        }
      } else {
        result.missions.push({ type: msn.type, title: msn.title, status: 'skipped', reason: 'no MissionManager' });
        logger.warn({ planId, type: msn.type }, 'MissionManager not available, mission skipped');
      }
    }

    const hasErrors = result.commands.some((c: any) => c?.error || c?.status === 'failed')
      || result.missions.some((m: any) => m?.error || m?.status === 'failed');

    this.trackExecutionMetrics(result);
    this.upsertHistory({
      planId,
      input: plan.input,
      plan,
      result,
      status: hasErrors ? 'partial_failure' : 'executed',
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
      const data = {
        history: this.history,
        drafts: this.drafts,
      };
      atomicWriteJsonSync(HISTORY_FILE, data);
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
