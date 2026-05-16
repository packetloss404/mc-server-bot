/**
 * ChronicleGenerator — Phase 4-B of the Autonomous Town Builder.
 *
 * Once per Minecraft day (20 real minutes — see ChronicleScheduler) this
 * generator wakes up per active town, pulls the day's events + key residents,
 * feeds them to the LLM, and persists a 2-3 paragraph narrative entry into
 * `chronicle_entries`. Milestone entries (founding, tier upgrade, raid
 * survived, mayor change, first death) get the same treatment but are
 * triggered ad-hoc rather than on the daily cadence.
 *
 * Failure isolation: every LLM call is wrapped — a throw becomes a fallback
 * "Quiet day in <town>." placeholder so the chronicle feed never silently
 * stalls. Budget cap (config.chronicleBudgetUsd) is enforced per Minecraft day
 * per town: when the cap is hit the daily entry is skipped and a
 * `chronicle:budget_capped` event is recorded.
 *
 * Spec: TOWN_BUILDER_SPEC.md §5 (chronicle budget) + §10 (chronicle_entries).
 */
import { logger } from '../util/logger';
import type { LLMClient } from '../ai/LLMClient';
import type { TownManager, ChronicleEntry } from './TownManager';
import type { Town, TownEvent, Resident } from './Town';
import * as budgetLedger from './budgetLedger';

/** Default per-day budget (USD) for chronicle calls when town config omits it. */
const DEFAULT_BUDGET_USD = 0.5;

/** Cap response tokens so a runaway LLM can't blow the budget on one call. */
const MAX_RESPONSE_TOKENS = 800;

/** Cap events fed into the prompt so a noisy day doesn't bloat the call. */
const MAX_EVENTS_IN_PROMPT = 60;

/** Cap residents fed into the prompt; pick the most-recently joined first. */
const MAX_RESIDENTS_IN_PROMPT = 8;

/**
 * Cheap heuristic cost of one chronicle call. The TokenLedger doesn't expose
 * per-call cost back to callers in real time, so we estimate using flash-tier
 * pricing (~$0.15 input + $0.60 output / 1M tokens). For ~2000 input tokens
 * + 600 output tokens that's roughly $0.0006 per call — well under the
 * spec's $0.50/day target. The estimate is conservative enough that the
 * budget cap still fires correctly even when a more expensive model is in
 * use; routers may downgrade the route after a few high-cost calls.
 */
const ESTIMATED_COST_PER_CALL_USD = 0.05;

/** Milestone kinds the spec calls out + a few obvious additions. */
export type MilestoneKind =
  | 'town_founded'
  | 'tier_upgrade'
  | 'raid_survived'
  | 'mayor_change'
  | 'first_death'
  | 'building_completed'
  | 'population_milestone'
  | string;

export interface ChronicleGeneratorOptions {
  /**
   * Hard ceiling per town per Minecraft day. Defaults to 0.5 USD if the
   * town's config.chronicleBudgetUsd is missing. Caller can override
   * (mostly for tests).
   */
  defaultBudgetUsd?: number;
}

/**
 * Followup #48 — payload shape broadcast on the `town:chronicle` socket
 * event. The API layer registers a callback via `setEventEmitter()` so
 * both manual (`POST /chronicle/generate`) and scheduler-driven paths
 * fan out the same payload to dashboard subscribers.
 */
export interface ChronicleEmitPayload {
  townId: string;
  dayNumber: number;
  entry: ChronicleEntry;
  /** 'daily' | 'milestone' — surfaced so consumers can filter the stream. */
  kind: ChronicleEntry['kind'];
}

export type ChronicleEventEmitter = (payload: ChronicleEmitPayload) => void;

export class ChronicleGenerator {
  private readonly townManager: TownManager;
  private readonly llm: LLMClient | null;
  private readonly defaultBudgetUsd: number;
  /**
   * Per (townId|dayNumber) accumulated cost. Cleared lazily — the scheduler's
   * once-per-day cadence keeps this map small (~one entry per town per day).
   *
   * Followup #45 — also persisted to `data/towns/<townId>/budget.json` so a
   * restart doesn't reset the budget. Per-town ledgers are loaded lazily on
   * first access (loadedTowns set) and saved synchronously after each
   * recordCost so the on-disk view never lags by more than one call.
   */
  private readonly dailyCostCents: Map<string, number> = new Map();
  /** Per-town hydration set so we only load each town's slice once. */
  private readonly loadedTowns: Set<string> = new Set();
  /**
   * Followup #48 — optional callback the API layer wires at startup so the
   * scheduler's auto-generated daily entries (and any milestone entries)
   * fan out over Socket.IO too. Kept as a callback so the generator
   * doesn't have to import socket.io. Errors are swallowed.
   */
  private eventEmitter: ChronicleEventEmitter | null = null;

  constructor(
    townManager: TownManager,
    llm: LLMClient | null,
    opts: ChronicleGeneratorOptions = {},
  ) {
    this.townManager = townManager;
    this.llm = llm;
    this.defaultBudgetUsd = opts.defaultBudgetUsd ?? DEFAULT_BUDGET_USD;
  }

  /**
   * Followup #48 — inject the socket-fanout callback. Idempotent: passing a
   * new callback replaces the previous one. Pass `null` to detach.
   */
  setEventEmitter(fn: ChronicleEventEmitter | null): void {
    this.eventEmitter = fn;
  }

  /**
   * Best-effort fanout — failures (throwing callback, socket teardown)
   * must never bubble up into the generator's caller. Logged + swallowed.
   */
  private emitChronicleEvent(payload: ChronicleEmitPayload): void {
    if (!this.eventEmitter) return;
    try {
      this.eventEmitter(payload);
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId: payload.townId, kind: payload.kind },
        'ChronicleGenerator: eventEmitter callback threw',
      );
    }
  }

  /**
   * Generate (or fetch the cached) daily chronicle entry for a town/day.
   * Idempotent: an existing 'daily' row for the given (townId, dayNumber)
   * short-circuits unless `force` is true.
   */
  async generateDaily(
    townId: string,
    dayNumber: number,
    opts: { force?: boolean } = {},
  ): Promise<ChronicleEntry | null> {
    const town = this.townManager.getTown(townId);
    if (!town) {
      logger.warn({ townId, dayNumber }, 'ChronicleGenerator.generateDaily: town not found');
      return null;
    }

    // Idempotent: respect existing row unless the caller forces.
    if (!opts.force) {
      const existing = this.townManager.getDailyChronicle(townId, dayNumber);
      if (existing) {
        return existing;
      }
    }

    // Budget check. Per spec, budget is per Minecraft day per town, so we key
    // the running tally on (townId|dayNumber). If the budget has already been
    // spent, record the cap event and bail without an LLM call.
    if (this.isOverBudget(townId, dayNumber, town)) {
      this.townManager.recordEvent({
        townId,
        kind: 'chronicle:budget_capped',
        severity: 'minor',
        payload: { dayNumber, budgetUsd: this.budgetFor(town) },
        highlightScore: 10,
      });
      logger.info(
        { townId, dayNumber, budgetUsd: this.budgetFor(town) },
        'Chronicle daily skipped — budget capped',
      );
      return null;
    }

    // Pull the day's window of events. Day 1 spans foundedAt..(foundedAt + 20m);
    // beyond that we walk forward in 20-minute windows.
    const window = this.dayWindow(town, dayNumber);
    const allEvents = this.townManager.listEvents(townId, { limit: 1000 });
    const dayEvents = allEvents.filter(
      (e) => e.occurredAt >= window.start && e.occurredAt < window.end,
    );
    const residents = this.townManager.listResidents(townId).filter(
      (r) => r.status === 'alive' || r.status == null,
    );

    let body: string;
    let model: string | null = null;

    if (this.llm == null || dayEvents.length === 0) {
      // Quiet day — no LLM call. Spec wants a placeholder, not a thrown error.
      body = this.quietDayPlaceholder(town, dayNumber, residents);
    } else {
      try {
        const result = await this.callLlm({
          town,
          dayNumber,
          events: dayEvents.slice(0, MAX_EVENTS_IN_PROMPT),
          residents: this.pickKeyResidents(residents),
        });
        body = result.body;
        model = result.model;
        this.recordCost(townId, dayNumber, ESTIMATED_COST_PER_CALL_USD);
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId, dayNumber },
          'ChronicleGenerator: LLM call failed; emitting placeholder',
        );
        body = this.quietDayPlaceholder(town, dayNumber, residents, {
          fallback: true,
        });
      }
    }

    const entry = this.townManager.insertChronicleEntry({
      townId,
      dayNumber,
      kind: 'daily',
      body,
      model,
    });
    this.townManager.recordEvent({
      townId,
      kind: 'chronicle:published',
      severity: 'info',
      payload: { dayNumber, chronicleId: entry.id, model },
      highlightScore: 30,
    });
    // Followup #48 — fan out so the scheduler's auto-generated entries
    // reach dashboard subscribers too (the manual /chronicle/generate
    // route already emits, but the scheduler path didn't until now).
    this.emitChronicleEvent({ townId, dayNumber, entry, kind: 'daily' });
    logger.info(
      { townId, dayNumber, model, bodyLen: body.length },
      'ChronicleGenerator: daily entry written',
    );
    return entry;
  }

  /**
   * Emit a milestone narrative entry. The scheduler (and TownBrain) calls
   * this when one of the spec's milestones fires. Independent of the
   * daily-budget cap because milestones are rare and high value.
   *
   * payload is rendered into the prompt so the LLM has the specific context
   * (e.g. tier_upgrade: { from: 'founding', to: 'village' }).
   */
  async generateMilestone(
    townId: string,
    kind: MilestoneKind,
    payload: Record<string, unknown> = {},
  ): Promise<ChronicleEntry | null> {
    const town = this.townManager.getTown(townId);
    if (!town) {
      logger.warn({ townId, kind }, 'ChronicleGenerator.generateMilestone: town not found');
      return null;
    }
    const dayNumber = this.townManager.getChronicleDayNumber(townId) ?? 1;

    let body: string;
    let model: string | null = null;

    if (this.llm == null) {
      body = this.milestonePlaceholder(town, kind, payload);
    } else {
      try {
        const result = await this.callLlmMilestone({ town, dayNumber, kind, payload });
        body = result.body;
        model = result.model;
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId, kind },
          'ChronicleGenerator: milestone LLM call failed; emitting placeholder',
        );
        body = this.milestonePlaceholder(town, kind, payload);
      }
    }

    const entry = this.townManager.insertChronicleEntry({
      townId,
      dayNumber,
      kind: 'milestone',
      body,
      model,
    });
    this.townManager.recordEvent({
      townId,
      kind: 'chronicle:milestone',
      severity: 'major',
      payload: { dayNumber, chronicleId: entry.id, milestone: kind, ...payload },
      highlightScore: 60,
    });
    // Followup #48 — fan out milestones too so the dashboard surfaces
    // ad-hoc entries (founding, tier upgrade, disaster) without waiting
    // for the next chronicle poll.
    this.emitChronicleEvent({ townId, dayNumber, entry, kind: 'milestone' });
    logger.info(
      { townId, dayNumber, kind, bodyLen: body.length },
      'ChronicleGenerator: milestone entry written',
    );
    return entry;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Prompt construction
  // ──────────────────────────────────────────────────────────────────────

  private async callLlm(input: {
    town: Town;
    dayNumber: number;
    events: TownEvent[];
    residents: Resident[];
  }): Promise<{ body: string; model: string | null }> {
    const systemPrompt = this.systemPrompt();
    const userPrompt = this.dailyUserPrompt(input);
    const response = await this.llm!.generate(systemPrompt, userPrompt, MAX_RESPONSE_TOKENS, {
      taskType: 'chat',
    });
    return {
      body: this.cleanResponseText(response.text),
      // The router's `generate` does not return the resolved model name, so we
      // record the task's model as 'chat-route' — the TokenLedger has the
      // real provider/model for cost analysis.
      model: 'chat-route',
    };
  }

  private async callLlmMilestone(input: {
    town: Town;
    dayNumber: number;
    kind: MilestoneKind;
    payload: Record<string, unknown>;
  }): Promise<{ body: string; model: string | null }> {
    const systemPrompt = this.systemPrompt();
    const userPrompt = this.milestoneUserPrompt(input);
    const response = await this.llm!.generate(systemPrompt, userPrompt, MAX_RESPONSE_TOKENS, {
      taskType: 'chat',
    });
    return {
      body: this.cleanResponseText(response.text),
      model: 'chat-route',
    };
  }

  private systemPrompt(): string {
    return [
      'You are the town chronicler — a warm, slightly wry narrator who turns a day of',
      'small-town minecraft events into a 2-3 paragraph story (~150-250 words).',
      'Voice rules:',
      '  - Past tense, third person, present-day style.',
      '  - Name residents by their bot names when they appear in the events.',
      '  - Lean into character; embellish small moments instead of just listing them.',
      '  - End with one short forward-looking sentence about what tomorrow may bring.',
      '  - No bullet lists, no headers, no markdown — just prose paragraphs.',
      '  - If events are sparse, write a quiet vignette instead of padding.',
    ].join('\n');
  }

  private dailyUserPrompt(input: {
    town: Town;
    dayNumber: number;
    events: TownEvent[];
    residents: Resident[];
  }): string {
    const lines: string[] = [];
    lines.push(`Town: ${input.town.name}`);
    lines.push(`Tier: ${input.town.tier}`);
    if (input.town.styleSeed) lines.push(`Style: ${input.town.styleSeed}`);
    lines.push(`Day: ${input.dayNumber}`);
    lines.push('');
    lines.push('Key residents:');
    if (input.residents.length === 0) {
      lines.push('  (none yet — the town is still finding its first hands)');
    } else {
      for (const r of input.residents) {
        const role = r.currentRole ?? 'unassigned';
        lines.push(`  - ${r.botName} (${role})`);
      }
    }
    lines.push('');
    lines.push(`Events for day ${input.dayNumber}:`);
    if (input.events.length === 0) {
      lines.push('  (no events recorded)');
    } else {
      for (const e of input.events) {
        lines.push(`  - ${this.formatEventForPrompt(e)}`);
      }
    }
    lines.push('');
    lines.push(`Write the chronicle entry for ${input.town.name}, Day ${input.dayNumber}.`);
    return lines.join('\n');
  }

  private milestoneUserPrompt(input: {
    town: Town;
    dayNumber: number;
    kind: MilestoneKind;
    payload: Record<string, unknown>;
  }): string {
    const lines: string[] = [];
    lines.push(`Town: ${input.town.name}`);
    lines.push(`Tier: ${input.town.tier}`);
    lines.push(`Day: ${input.dayNumber}`);
    lines.push(`Milestone: ${input.kind}`);
    lines.push('');
    lines.push('Milestone details:');
    for (const [key, value] of Object.entries(input.payload)) {
      lines.push(`  - ${key}: ${this.formatScalar(value)}`);
    }
    lines.push('');
    lines.push(
      'Write a punchy 2 paragraph entry (~120-180 words) marking this milestone for the town.',
    );
    return lines.join('\n');
  }

  /** Render one event as a single readable line for the prompt. */
  private formatEventForPrompt(e: TownEvent): string {
    const payload = e.payload ? this.formatScalar(e.payload) : '';
    const sev = e.severity ?? 'info';
    return `[${sev}] ${e.kind}${payload ? ` — ${payload}` : ''}`;
  }

  private formatScalar(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      const s = JSON.stringify(value);
      // Trim long payloads — chronicles want vibes, not deeply nested JSON.
      return s.length > 240 ? `${s.slice(0, 237)}...` : s;
    } catch {
      return String(value);
    }
  }

  /**
   * Strip leading/trailing whitespace, drop any accidental code fences or
   * <think> blocks (MiniMax router behavior). Keep the prose intact.
   */
  private cleanResponseText(raw: string): string {
    let text = raw.trim();
    // MiniMax-style chain-of-thought is already stripped by the router, but be
    // defensive in case another provider leaks one.
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // Strip surrounding ``` fences if the LLM tried to format as code.
    if (text.startsWith('```')) {
      text = text.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '').trim();
    }
    return text;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Placeholders + helpers
  // ──────────────────────────────────────────────────────────────────────

  private quietDayPlaceholder(
    town: Town,
    dayNumber: number,
    residents: Resident[],
    opts: { fallback?: boolean } = {},
  ): string {
    const headcount = residents.length;
    const head =
      headcount === 0
        ? `Quiet day in ${town.name}. The streets stood empty, waiting for the first resident to make their way home.`
        : headcount === 1
        ? `Quiet day in ${town.name}. ${residents[0].botName} kept the lights on, and that was about it.`
        : `Quiet day in ${town.name}. Its ${headcount} residents kept their heads down and let the dust settle.`;
    if (opts.fallback) {
      return `${head} (Chronicle entry written automatically — narrator was offline this day.)`;
    }
    return `${head}\n\nThere were no events worth retelling on day ${dayNumber}; the chronicler suspects tomorrow will be a different story.`;
  }

  private milestonePlaceholder(
    town: Town,
    kind: MilestoneKind,
    payload: Record<string, unknown>,
  ): string {
    const detail = Object.entries(payload)
      .map(([k, v]) => `${k}=${this.formatScalar(v)}`)
      .join(', ');
    return `Milestone in ${town.name}: ${kind}${detail ? ` (${detail})` : ''}. The chronicler will fill this in once the narrator is back online.`;
  }

  /**
   * Pick a manageable subset of residents for the prompt. Prefers the most
   * recently joined (interesting characters first), capped at
   * MAX_RESIDENTS_IN_PROMPT.
   */
  private pickKeyResidents(all: Resident[]): Resident[] {
    return [...all]
      .sort((a, b) => (b.joinedAt ?? 0) - (a.joinedAt ?? 0))
      .slice(0, MAX_RESIDENTS_IN_PROMPT);
  }

  /**
   * Day window — [start, end) in epoch ms. Mirrors the cadence used by
   * `getChronicleDayNumber`: 20 real minutes per Minecraft day.
   */
  private dayWindow(town: Town, dayNumber: number): { start: number; end: number } {
    const dayMs = 20 * 60 * 1000;
    const start = town.foundedAt + (dayNumber - 1) * dayMs;
    const end = start + dayMs;
    return { start, end };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Budget
  // ──────────────────────────────────────────────────────────────────────

  private budgetFor(town: Town): number {
    const cfgRaw = town.config?.chronicleBudgetUsd as unknown;
    if (typeof cfgRaw === 'number' && cfgRaw >= 0) return cfgRaw;
    return this.defaultBudgetUsd;
  }

  private isOverBudget(townId: string, dayNumber: number, town: Town): boolean {
    const budgetUsd = this.budgetFor(town);
    if (budgetUsd <= 0) return false;
    this.hydrateTownLedger(townId);
    const spentCents = this.dailyCostCents.get(this.budgetKey(townId, dayNumber)) ?? 0;
    return spentCents >= budgetUsd * 100;
  }

  private recordCost(townId: string, dayNumber: number, usd: number): void {
    this.hydrateTownLedger(townId);
    const key = this.budgetKey(townId, dayNumber);
    const next = (this.dailyCostCents.get(key) ?? 0) + usd * 100;
    this.dailyCostCents.set(key, next);
    this.persistTownLedger(townId);
  }

  private budgetKey(townId: string, dayNumber: number): string {
    return `${townId}|${dayNumber}`;
  }

  /**
   * Followup #45 — load the persisted chronicle slice for one town once per
   * process. Followup #64 — reads only the chronicle slice from its own file
   * (legacy `budget.json` is migrated through on the first save). Failures
   * are swallowed inside budgetLedger.loadChronicle; the generator falls
   * back to the in-memory map.
   */
  private hydrateTownLedger(townId: string): void {
    if (this.loadedTowns.has(townId)) return;
    this.loadedTowns.add(townId);
    const dataDir = this.dataDirOrNull();
    if (!dataDir) return;
    try {
      const ledger = budgetLedger.loadChronicle(dataDir, townId);
      const prefix = `${townId}|`;
      for (const [key, cents] of Object.entries(ledger.chronicleCostCentsByKey)) {
        if (!key.startsWith(prefix)) continue;
        // Only restore the slice for this town; cross-town keys are filtered
        // out so a corrupted ledger can't leak between towns.
        this.dailyCostCents.set(key, cents);
      }
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId },
        'ChronicleGenerator: hydrateTownLedger threw; continuing with empty in-memory state',
      );
    }
  }

  /**
   * Persist the chronicle slice for one town.
   * Followup #64 — writes only the chronicle slice into its own file so a
   * concurrent design save can no longer clobber the chronicle slice (or
   * vice versa) around the LLM call window. Failures are swallowed inside
   * budgetLedger.saveChronicle.
   */
  private persistTownLedger(townId: string): void {
    const dataDir = this.dataDirOrNull();
    if (!dataDir) return;
    try {
      // Walk our in-memory map and pick out keys for this town.
      const prefix = `${townId}|`;
      const chronicleCostCentsByKey: Record<string, number> = {};
      for (const [key, cents] of this.dailyCostCents.entries()) {
        if (!key.startsWith(prefix)) continue;
        chronicleCostCentsByKey[key] = cents;
      }
      budgetLedger.saveChronicle(dataDir, townId, { chronicleCostCentsByKey });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId },
        'ChronicleGenerator: persistTownLedger threw; in-memory state retained',
      );
    }
  }

  /**
   * Resolve the data dir by asking the TownManager. Returns null when the
   * town manager doesn't expose getDataDir (older instantiations / tests).
   */
  private dataDirOrNull(): string | null {
    try {
      const tm = this.townManager as { getDataDir?: () => string };
      const dir = typeof tm.getDataDir === 'function' ? tm.getDataDir() : null;
      return dir ?? null;
    } catch {
      return null;
    }
  }
}
