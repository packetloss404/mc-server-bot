import fs from 'fs';
import path from 'path';
import { LLMClient } from '../ai/LLMClient';
import { logger } from '../util/logger';

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

/** Minimal interface for dispatching commands (avoids circular imports). */
export interface CommandDispatcher {
  createCommand(params: { type: string; targets: string[]; params?: Record<string, any>; source?: string }): any;
  dispatchCommand(command: any, force?: boolean): Promise<any>;
}

/** Minimal interface for creating missions (avoids circular imports). */
export interface MissionCreator {
  createMission(params: { type: string; title: string; description?: string; assigneeType: 'bot' | 'squad'; assigneeIds: string[]; priority?: string; source?: string }): any;
}

// ── Service ──────────────────────────────────────────────

export class CommanderService {
  private llmClient: LLMClient | null;
  private commandCenter: CommandDispatcher | null = null;
  private missionManager: MissionCreator | null = null;
  private plans: Map<string, CommanderPlan> = new Map();
  private history: CommanderHistoryEntry[] = [];
  private drafts: CommanderDraft[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Metrics counters ───────────────────────────────────
  // Intentionally ephemeral: these are session-scoped counters that reset on
  // restart. They reflect current-session activity, not historical data.
  // Historical analysis can be derived from the persisted command history.
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

  // ── Wiring setters ──────────────────────────────────────

  /** Wire in an LLM client for better intent extraction. */
  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
    logger.info('CommanderService: LLM client wired');
  }

  /** Wire in the CommandCenter for dispatching commands during execute(). */
  setCommandCenter(cc: CommandDispatcher): void {
    this.commandCenter = cc;
    logger.info('CommanderService: CommandCenter wired');
  }

  /** Wire in the MissionManager for creating missions during execute(). */
  setMissionManager(mm: MissionCreator): void {
    this.missionManager = mm;
    logger.info('CommanderService: MissionManager wired');
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

    // Track command types from the parsed intent
    if (plan.intent && plan.intent !== 'unknown') {
      this.commandTypeCounts[plan.intent] = (this.commandTypeCounts[plan.intent] || 0) + 1;
    }

    // Track individual command types from the plan
    for (const cmd of plan.commands) {
      if (cmd.type) {
        this.commandTypeCounts[cmd.type] = (this.commandTypeCounts[cmd.type] || 0) + 1;
      }
    }

    // Track mission types from the plan
    for (const mission of plan.missions) {
      if (mission.type) {
        this.missionTypeCounts[mission.type] = (this.missionTypeCounts[mission.type] || 0) + 1;
      }
    }
  }

  private trackExecutionMetrics(result: CommanderExecuteResult): void {
    this.totalExecutions++;

    // Detect partial failures: some commands/missions present but result arrays
    // contain items with error indicators
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

  // ── LLM-based parsing ────────────────────────────────────

  private async llmParse(input: string): Promise<{ intent: string; confidence: number; targets: string[]; params: Record<string, unknown> } | null> {
    if (!this.llmClient) return null;

    try {
      const systemPrompt = `You are a Minecraft bot fleet commander parser. Given a natural language command, extract structured intent.
Respond ONLY with valid JSON, no markdown. Schema:
{ "intent": string, "confidence": number 0-1, "targets": string[], "params": {} }
Valid intents: pause_bots, resume_bots, move_bots, mine_task, farm_task, guard_zone, patrol_route, craft_task, follow_player, regroup, unknown.
Targets are bot names or role names (e.g. ["Ada"], ["all"], ["guards"]).`;

      const resp = await this.llmClient.generate(systemPrompt, input, 256);
      const text = resp.text.trim();
      // Strip markdown fences if present
      const jsonStr = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed.intent === 'string' && typeof parsed.confidence === 'number') {
        return {
          intent: parsed.intent,
          confidence: Math.max(0, Math.min(1, parsed.confidence)),
          targets: Array.isArray(parsed.targets) ? parsed.targets : [],
          params: parsed.params && typeof parsed.params === 'object' ? parsed.params : {},
        };
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'LLM parse failed, falling back to regex');
    }
    return null;
  }

  // ── Target extraction helpers ────────────────────────────

  private extractTargets(input: string): string[] {
    const lowerInput = input.toLowerCase();
    const targets: string[] = [];

    // Check for named bots
    const botNames = ['ada', 'bob', 'carl', 'dan', 'eve', 'fay'];
    for (const name of botNames) {
      const regex = new RegExp(`\\b${name}\\b`, 'i');
      const match = input.match(regex);
      if (match) {
        // Preserve original casing from input
        targets.push(match[0]);
      }
    }

    // Check for role-based targeting
    const roles = ['guard', 'farmer', 'miner', 'explorer', 'blacksmith', 'merchant'];
    for (const role of roles) {
      if (new RegExp(`\\b${role}s?\\b`, 'i').test(lowerInput)) {
        targets.push(`role:${role}`);
      }
    }

    // Check for "all" keyword
    if (/\ball\b/.test(lowerInput) && targets.length === 0) {
      targets.push('all');
    }

    return targets;
  }

  // ── Intent to command/mission mapping ───────────────────

  private static INTENT_TO_COMMAND_TYPE: Record<string, string> = {
    pause_bots: 'pause_voyager',
    resume_bots: 'resume_voyager',
    move_bots: 'walk_to_coords',
    guard_zone: 'guard_zone',
    patrol_route: 'patrol_route',
    follow_player: 'follow_player',
    regroup: 'regroup',
  };

  private static INTENT_TO_MISSION_TYPE: Record<string, string> = {
    mine_task: 'queue_task',
    farm_task: 'queue_task',
    craft_task: 'craft_items',
  };

  private generateCommandsAndMissions(
    intent: string,
    targets: string[],
    input: string,
  ): { commands: CommanderPlanCommand[]; missions: CommanderPlanMission[] } {
    const commands: CommanderPlanCommand[] = [];
    const missions: CommanderPlanMission[] = [];

    // If no targets were identified, use a placeholder so the plan is still actionable
    const effectiveTargets = targets.length > 0 ? targets : ['all'];

    const cmdType = CommanderService.INTENT_TO_COMMAND_TYPE[intent];
    const msnType = CommanderService.INTENT_TO_MISSION_TYPE[intent];

    if (cmdType) {
      commands.push({
        type: cmdType,
        targets: effectiveTargets,
        payload: {},
      });
    } else if (msnType) {
      missions.push({
        type: msnType,
        title: `${intent}: ${input.slice(0, 60)}`,
        description: input,
        assigneeIds: effectiveTargets,
      });
    } else if (intent !== 'unknown') {
      // Fallback: generate a generic queue_task mission for recognized but unmapped intents
      missions.push({
        type: 'queue_task',
        title: `${intent}: ${input.slice(0, 60)}`,
        description: input,
        assigneeIds: effectiveTargets,
      });
    }

    return { commands, missions };
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
      this.trackParseMetrics(plan);
      return plan;
    }

    // Derive intent and confidence -- try LLM first, fall back to regex
    let intent = '';
    let confidence = 0;
    let targets: string[] = [];
    const warnings: string[] = [];

    const llmResult = await this.llmParse(trimmedInput);

    if (llmResult) {
      intent = llmResult.intent;
      confidence = llmResult.confidence;
      targets = llmResult.targets;
      logger.info({ intent, confidence, targets }, 'Commander: LLM parse succeeded');
    } else {
      // Regex fallback (original heuristic logic)
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

      // Extract targets from input when using regex fallback
      targets = this.extractTargets(trimmedInput);
    }

    // Check for specificity
    const hasNamedBot = targets.some((t) => !t.startsWith('role:') && t !== 'all');
    const hasAllBots = targets.includes('all');
    const hasRole = targets.some((t) => t.startsWith('role:'));
    const hasCoords = /\b-?\d+\s*,?\s*-?\d+\b/.test(trimmedInput.toLowerCase());

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

    // Generate concrete commands and missions based on intent and targets
    const { commands, missions } = this.generateCommandsAndMissions(intent, targets, trimmedInput);

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
    this.trackParseMetrics(plan);
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

    const commandResults: unknown[] = [];
    const missionResults: unknown[] = [];

    // Dispatch each command through CommandCenter if available
    for (const cmd of plan.commands) {
      if (this.commandCenter) {
        try {
          const created = this.commandCenter.createCommand({
            type: cmd.type,
            targets: cmd.targets,
            params: cmd.payload,
            source: 'commander',
          });
          const dispatched = await this.commandCenter.dispatchCommand(created);
          commandResults.push({ id: dispatched.id, type: cmd.type, targets: cmd.targets, status: dispatched.status });
        } catch (err: any) {
          logger.error({ err: err.message, cmdType: cmd.type }, 'Commander: command dispatch failed');
          commandResults.push({ type: cmd.type, targets: cmd.targets, status: 'failed', error: err.message });
        }
      } else {
        // No CommandCenter wired -- record as accepted but not dispatched
        commandResults.push({ type: cmd.type, targets: cmd.targets, status: 'accepted', note: 'CommandCenter not wired' });
        logger.info({ cmdType: cmd.type, targets: cmd.targets }, 'Commander: command recorded (no CommandCenter)');
      }
    }

    // Create each mission through MissionManager if available
    for (const msn of plan.missions) {
      if (this.missionManager) {
        try {
          const created = this.missionManager.createMission({
            type: msn.type,
            title: msn.title,
            description: msn.description,
            assigneeType: 'bot',
            assigneeIds: msn.assigneeIds,
            priority: 'normal',
            source: 'commander',
          });
          missionResults.push({ id: created.id, type: msn.type, title: msn.title, status: created.status });
        } catch (err: any) {
          logger.error({ err: err.message, msnType: msn.type }, 'Commander: mission creation failed');
          missionResults.push({ type: msn.type, title: msn.title, status: 'failed', error: err.message });
        }
      } else {
        // No MissionManager wired -- record as accepted but not dispatched
        missionResults.push({ type: msn.type, title: msn.title, assigneeIds: msn.assigneeIds, status: 'accepted', note: 'MissionManager not wired' });
        logger.info({ msnType: msn.type, title: msn.title }, 'Commander: mission recorded (no MissionManager)');
      }
    }

    const result: CommanderExecuteResult = { commands: commandResults, missions: missionResults };
    this.trackExecutionMetrics(result);

    const hasErrors = commandResults.some((c: any) => c.status === 'failed') ||
                      missionResults.some((m: any) => m.status === 'failed');

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
