/**
 * TownBrain — Phase 2 + Phase 3 of the Autonomous Town Builder.
 *
 * One brain per active town. Wakes up every 60s and runs five sub-loops
 * sequentially (demand → build → role → schedule → threat). The brain's job
 * is to seed the blackboard and build queue with town-shaped intent; the
 * existing Voyager loop on each bot then picks up tasks like any other.
 *
 * Failure isolation: every loop is wrapped in try/catch so one broken loop
 * never crashes the tick. Paused towns no-op on every loop.
 *
 * What this brain DOES NOT do (yet):
 *  - Phase 5 wires threat aggregation (currently a stub).
 *  - Phase 4 routes building requests through an LLM design pipeline; for
 *    now we hand the schematicQuery straight to BuildCoordinator with the
 *    default schematic file.
 *
 * Spec: TOWN_BUILDER_SPEC.md §4 (architecture, Layer 2) + the implementation
 * briefs in the Phase 2 and Phase 3 tickets.
 */
import path from 'path';
import type { TownManager } from './TownManager';
import type { BotManager } from '../bot/BotManager';
import type { BuildCoordinator } from '../build/BuildCoordinator';
import type { BlackboardManager } from '../voyager/BlackboardManager';
import type { SchematicMatcher } from '../build/SchematicMatcher';
import type { Building, Town, TownEvent } from './Town';
import type { PlanItem, TownTier } from './PlanItem';
import type { StyleDoc } from './StyleDoc';
import { loadStyle } from './StyleDoc';
import { getRequiredBuildings as getMedievalPlan } from './seed/medieval';
import { getRequiredBuildings as getMidCenturyPlan } from './seed/midcentury';
import { RoleManager } from './RoleManager';
import { ScheduleManager } from './ScheduleManager';
import {
  LlmDesigner,
  dimensionsFor,
  type DesignResult,
  type NeighborContext,
} from './LlmDesigner';
import { DesignCache, buildStyleHashInput } from './DesignCache';
import { StyleObserver } from './StyleObserver';
import { DistrictManager } from './DistrictManager';
import { ExpansionManager } from './ExpansionManager';
import { PhoenixManager } from './PhoenixManager';
import { ApprovalManager } from './ApprovalManager';
import { DecreeManager } from './DecreeManager';
import { GreetingDispatcher } from './GreetingDispatcher';
import type { MayorService } from './MayorService';
import { TradeRouteManager } from './TradeRouteManager';
import type { DiplomacyManager } from './DiplomacyManager';
import type { InteractionKind } from './Relationship';
import {
  CORE_RESOURCE_THRESHOLDS,
  RESOURCE_KEYWORDS,
  RESOURCE_ROLE,
} from './resourceThresholds';
import * as budgetLedger from './budgetLedger';
import { logger } from '../util/logger';

/**
 * Phase 7-B — emit a `rival:patrol` signal every N brain ticks for guards in
 * rivalry-bound towns. Phase 7 just emits the signal; actual guard-behavior
 * change is out of scope.
 */
const RIVAL_PATROL_TICK_INTERVAL = 5;

/**
 * Phase 7-A — diplomacy loop knobs.
 *
 *  - DIPLOMACY_PEER_RADIUS_BLOCKS: only consider peers whose capital lies
 *    within this horizontal distance of the local town's capital. Keeps the
 *    cross-town scan bounded for large worlds.
 *  - DIPLOMACY_BORDER_DISTANCE_BLOCKS: an expansion is a `border_violation`
 *    when the new child capital is within this many blocks of an existing
 *    peer's capital. Tightens the noisy-neighbor heuristic.
 *  - DIPLOMACY_TRIGGER_COOLDOWN_MS: per-(townIdPair, kind) cooldown so the
 *    diplomacyLoop doesn't re-record the same interaction every tick.
 */
const DIPLOMACY_PEER_RADIUS_BLOCKS = 256;
const DIPLOMACY_BORDER_DISTANCE_BLOCKS = 100;
const DIPLOMACY_TRIGGER_COOLDOWN_MS = 10 * 60 * 1000;

const TICK_INTERVAL_MS = 60_000;

export interface TownBrainStatus {
  townId: string;
  running: boolean;
  paused: boolean;
  lastTickAt: number | null;
  ticks: number;
}

export class TownBrain {
  private readonly townId: string;
  private readonly townManager: TownManager;
  private readonly botManager: BotManager;
  private readonly buildCoordinator: BuildCoordinator;
  private readonly blackboard: BlackboardManager;
  private readonly roleManager: RoleManager;
  private readonly scheduleManager: ScheduleManager;
  /** Tick cadence (defaults to 60s; override for tests). */
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private paused = false;
  private lastTickAt: number | null = null;
  private tickCount = 0;
  /** Prevent overlapping ticks if a tick runs longer than the interval. */
  private tickInFlight = false;
  /**
   * Snapshot of the most recent resource shortages from the demand loop,
   * handed to the role loop on the same tick. Cleared each tick.
   */
  private currentTickShortages: string[] = [];
  /** Phase 4 — optional library matcher used when the LLM design fails. */
  private readonly schematicMatcher: SchematicMatcher | null;
  /** Phase 4 — LLM-driven block-plan generator. Null when no LLM client is wired. */
  private readonly llmDesigner: LlmDesigner | null;
  /** Phase 4 — per-town design cache rooted at `schematics/<townId>/`. */
  private readonly designCache: DesignCache;
  /** Phase 4 — observation writer for the realized-palette feedback loop. */
  private readonly styleObserver: StyleObserver;
  /** Phase 4 — per-day (UTC) LLM spend ledger, keyed by yyyy-mm-dd. */
  private readonly dailySpendUsd: Map<string, number> = new Map();
  /** Track if we've already emitted budget:capped for a given day to avoid spam. */
  private readonly budgetCappedLogged: Set<string> = new Set();
  /** Style-hashes whose cache hits we've already observed during this brain's
   *  lifetime; prevents re-observing on every tick. */
  private readonly observedCacheHashes: Set<string> = new Set();
  /** Phase 5-B — district lifecycle owner (tier-up adds a second district). */
  private readonly districtManager: DistrictManager;
  /** Phase 5-B — child-town proposer (capped daily, first child auto-approved). */
  private readonly expansionManager: ExpansionManager;
  /**
   * Phase 5-A — Phoenix self-healing loop owner. Tracks damaged/destroyed
   * buildings and dead residents, queues repairs/rebuilds/replacements, and
   * places Memorial Park monuments. Chronicle + MarkerStore deps are wired
   * post-construction via `setChronicleGenerator()`/`setMarkerStore()` since
   * those exist only after the brain is built.
   */
  private readonly phoenixManager: PhoenixManager;
  /**
   * Phase 6-A — mayor service + per-tick greeting dispatcher. The dispatcher
   * piggybacks on this brain's tick instead of running its own 30s timer so
   * the paused gate + townManager teardown are honored automatically.
   */
  private readonly mayorService: MayorService;
  private readonly greetingDispatcher: GreetingDispatcher;
  /**
   * Phase 6-B — approvals queue manager. Owned per-brain so the resolveOnce
   * registry is isolated per town (matches the per-town tick cadence).
   * Wired into the ExpansionManager so 2nd+ child proposals open an approval
   * row + replay-on-approve handler.
   */
  private readonly approvalManager: ApprovalManager;
  /**
   * Project Sid P2-C — bot-initiated decree producer. Only constructed when
   * `config.governance.enabled`; null otherwise (the proposal path is a
   * complete no-op when governance is off). Turns an approved `decree`
   * approval into a live standing rule via the BotManager-owned RuleStore.
   */
  private readonly decreeManager: DecreeManager | null;
  /**
   * Phase 7-B — allied-town surplus/shortage matcher. Emits swarm-priority
   * blackboard tasks for cross-town deliveries when two towns are `allied`
   * per the diplomacy graph. In-memory only for Phase 7 (no DB persistence).
   */
  private readonly tradeRouteManager: TradeRouteManager;
  /**
   * Phase 7-A — directed-edge diplomacy graph. Shared with every other
   * brain via TownManager.getDiplomacyManager() so sustain counters and the
   * relationship table live in exactly one place.
   */
  private readonly diplomacyManager: DiplomacyManager;
  /**
   * Phase 7-A — per-(townIdPair, kind) cooldown ledger so the diplomacy
   * loop doesn't re-record the same trigger every 60s. Keyed by
   * `${initiatorId}|${peerId}|${kind}`; value is the next eligible epoch ms.
   * In-memory only — restart conservatively resets every cooldown.
   */
  private readonly diplomacyCooldowns: Map<string, number> = new Map();
  /**
   * Phase 7-A — high-water mark for the cross-town event scan. The diplomacy
   * loop walks recent town events (expansion/disaster/decree) to look for
   * triggers; we track the newest already-processed `occurredAt` so a tick
   * never re-scans the same event window. Initialised at construction time
   * (a brain's first tick only sees events from after boot).
   */
  private diplomacyEventCursor: number = Date.now();
  /**
   * Phase 5-B — tier snapshot from the previous tick. Lets the district loop
   * detect village→town transitions without an explicit hook. Initialised
   * lazily on the first tick so a freshly-constructed brain doesn't fire a
   * spurious tier-upgrade on startup.
   */
  private lastSeenTier: string | null = null;

  constructor(
    townId: string,
    townManager: TownManager,
    botManager: BotManager,
    buildCoordinator: BuildCoordinator,
    blackboard: BlackboardManager,
    opts: {
      intervalMs?: number;
      roleManager?: RoleManager;
      scheduleManager?: ScheduleManager;
      /** Phase 4 — library fallback matcher; optional in tests. */
      schematicMatcher?: SchematicMatcher;
    } = {},
  ) {
    this.townId = townId;
    this.townManager = townManager;
    this.botManager = botManager;
    this.buildCoordinator = buildCoordinator;
    this.blackboard = blackboard;
    this.intervalMs = opts.intervalMs ?? TICK_INTERVAL_MS;
    this.roleManager = opts.roleManager ?? new RoleManager(townManager, botManager);
    this.scheduleManager = opts.scheduleManager ?? new ScheduleManager(townManager, blackboard);
    this.schematicMatcher = opts.schematicMatcher ?? null;
    const llmClient = botManager.getLLMClient();
    this.llmDesigner = llmClient ? new LlmDesigner({ llmClient }) : null;
    // Design cache lives next to the canonical schematics dir so build coord
    // can also load cached files directly should it ever learn to.
    const schematicsRoot = path.join(process.cwd(), 'schematics');
    this.designCache = new DesignCache(schematicsRoot);
    this.styleObserver = new StyleObserver(townManager, townManager.getDataDir?.() ?? path.join(process.cwd(), 'data'));
    // Followup #45 — load the persisted design-LLM spend ledger so a brain
    // restart honours yesterday's cap. Followup #64 — read only the design
    // slice from its own file (legacy `budget.json` is migrated through on the
    // first save). Failures inside budgetLedger.loadDesign are swallowed and
    // logged; the brain falls back to an empty ledger.
    try {
      const ledger = budgetLedger.loadDesign(
        townManager.getDataDir?.() ?? path.join(process.cwd(), 'data'),
        townId,
      );
      for (const [day, usd] of Object.entries(ledger.designSpendUsdByDay)) {
        this.dailySpendUsd.set(day, usd);
      }
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId },
        'TownBrain: failed to load budget ledger; starting empty',
      );
    }
    // Phase 5-B — district + self-expansion managers. Both are stateless
    // wrappers around TownManager; constructing them here keeps the tick
    // loop's dependency wiring centralised.
    this.districtManager = new DistrictManager(townManager);
    this.expansionManager = new ExpansionManager(townManager);
    // Phase 5-A — Phoenix self-healing. Chronicler + marker store are
    // injected post-construction by TownManager.wirePhoenixDeps once the
    // API layer builds them (api.ts ordering keeps the brain constructor
    // small).
    this.phoenixManager = new PhoenixManager(
      townManager,
      botManager,
      buildCoordinator,
      blackboard,
    );
    // Phase 6-A — share the TownManager-owned MayorService singleton so the
    // cooldown ledger is consistent across the brain and the API layer.
    this.mayorService = townManager.getMayorService();
    this.greetingDispatcher = new GreetingDispatcher(townManager, botManager, this.mayorService);
    // Phase 6-B — approvals queue. Wired into the expansion manager so the
    // 2nd+ child proposal pathway opens an approval row + registers the
    // replay-on-approve hook.
    this.approvalManager = new ApprovalManager(townManager);
    this.expansionManager.setApprovalManager(this.approvalManager);
    // Project Sid P2-C — bot-initiated decrees. Only wired when the
    // governance flag is on; when off, decreeManager stays null so no
    // decree approvals are ever produced (complete no-op). On approval the
    // manager writes a standing rule via the BotManager-owned RuleStore.
    this.decreeManager = botManager.getConfig().governance?.enabled
      ? new DecreeManager(townManager, botManager.getRuleStore(), this.approvalManager)
      : null;
    // Phase 7-B — allied-town trade route manager. Reads the diplomacy graph
    // (P7-A) at tick time; degrades to a no-op when the diplomacy manager
    // isn't wired yet.
    this.tradeRouteManager = new TradeRouteManager(townManager, botManager, blackboard);
    // Phase 7-A — share the TownManager-owned DiplomacyManager singleton so
    // the sustain-counter map is consistent across the brain and the API.
    this.diplomacyManager = townManager.getDiplomacyManager();
  }

  /** Exposed so TownManager (and the API) can call assignment outside the tick. */
  getRoleManager(): RoleManager {
    return this.roleManager;
  }

  /** Exposed so the API can read the schedule table for the dashboard. */
  getScheduleManager(): ScheduleManager {
    return this.scheduleManager;
  }

  /** Phase 5-B — exposed so the API can list districts + trigger admin overrides. */
  getDistrictManager(): DistrictManager {
    return this.districtManager;
  }

  /** Phase 5-B — exposed so the API can read expansion status + force proposals. */
  getExpansionManager(): ExpansionManager {
    return this.expansionManager;
  }

  /** Phase 5-A — exposed so the API/TownManager can wire post-hoc deps + read state. */
  getPhoenixManager(): PhoenixManager {
    return this.phoenixManager;
  }

  /** Phase 6-B — exposed so the API can list / decide / cast votes on approvals. */
  getApprovalManager(): ApprovalManager {
    return this.approvalManager;
  }

  /** Project Sid P2-C — exposed so the API can file bot-initiated decree
   *  proposals. Null when `config.governance.enabled` is off. */
  getDecreeManager(): DecreeManager | null {
    return this.decreeManager;
  }

  /** Phase 7-B — exposed so the API can list this town's open allied trade routes. */
  getTradeRouteManager(): TradeRouteManager {
    return this.tradeRouteManager;
  }

  /** Begin periodic ticking. Idempotent — a second call is a no-op. */
  start(): void {
    if (this.timer) return;
    logger.info({ townId: this.townId, intervalMs: this.intervalMs }, 'TownBrain start');
    this.timer = setInterval(() => {
      void this.runTick();
    }, this.intervalMs);
    // Don't let the brain's timer hold the event loop open at shutdown.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** Stop the brain entirely. After stop(), start() may be called again. */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info({ townId: this.townId }, 'TownBrain stop');
  }

  /**
   * Pause decision-making. Existing tasks/builds continue — the brain just
   * stops queuing new work on the next tick.
   */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    logger.info({ townId: this.townId }, 'TownBrain pause');
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    logger.info({ townId: this.townId }, 'TownBrain resume');
  }

  isPaused(): boolean {
    return this.paused;
  }

  getStatus(): TownBrainStatus {
    return {
      townId: this.townId,
      running: this.timer !== null,
      paused: this.paused,
      lastTickAt: this.lastTickAt,
      ticks: this.tickCount,
    };
  }

  /** Public for tests — drives one cycle without waiting for the interval. */
  async runTick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      await this.tick();
    } finally {
      this.tickInFlight = false;
      this.lastTickAt = Date.now();
      this.tickCount++;
    }
  }

  private async tick(): Promise<void> {
    if (this.paused) {
      logger.debug({ townId: this.townId }, 'TownBrain tick — paused, skipping');
      return;
    }
    const town = this.townManager.getTown(this.townId);
    if (!town) {
      logger.warn({ townId: this.townId }, 'TownBrain tick — town vanished, stopping');
      this.stop();
      return;
    }
    if (town.status !== 'active') {
      // Dormant / abandoned towns don't tick.
      return;
    }
    logger.debug({ townId: this.townId, tier: town.tier }, 'TownBrain tick');

    // Each loop is independent — one failing must not crash the tick.
    this.currentTickShortages = [];
    await this.runLoopSafe('demand', () => this.demandLoop(town));
    await this.runLoopSafe('build', () => this.buildLoop(town));
    await this.runLoopSafe('role', () => this.roleLoop(town));
    await this.runLoopSafe('schedule', () => this.scheduleLoop(town));
    await this.runLoopSafe('threat', () => this.threatLoop(town));
    // P5-A inserts `phoenix` here (between threat and district). The
    // canonical order is: demand → build → role → schedule → threat →
    // phoenix → district → expansion.
    await this.runLoopSafe('phoenix', () => this.phoenixLoop(town));
    await this.runLoopSafe('district', () => this.districtLoop(town));
    await this.runLoopSafe('expansion', () => this.expansionLoop(town));
    // Phase 6-B — approvalLoop sits AFTER expansion so any new approval rows
    // opened by this tick's expansionLoop participate immediately (heuristic
    // votes get cast on the same tick instead of waiting 60s).
    await this.runLoopSafe('approval', () => this.approvalLoop(town));
    // Phase 7-A — diplomacyLoop sits AFTER approval (so any newly-founded
    // child towns from this tick's expansion path are visible to the peer
    // scan) and BEFORE trade/rival/greeting so those loops see the latest
    // diplomatic state in the same tick.
    await this.runLoopSafe('diplomacy', () => this.diplomacyLoop(town));
    // Phase 7-B — tradeLoop + rivalLoop sit AFTER any diplomacyLoop P7-A
    // adds and BEFORE the greetingLoop so the trade tasks the brain queues
    // are already on the blackboard by the time bots are greeted/dispatched.
    // Both loops degrade to no-ops when the diplomacy graph is missing.
    await this.runLoopSafe('trade', () => this.tradeLoop(town));
    await this.runLoopSafe('rival', () => this.rivalLoop(town));
    // Phase 6-A — greetingLoop sits last in the chain so any state the
    // earlier loops mutate (e.g. residents) is already settled when the
    // dispatcher walks the resident list.
    await this.runLoopSafe('greeting', () => this.greetingLoop(town));
  }

  private async runLoopSafe(name: string, fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err: any) {
      logger.warn(
        { townId: this.townId, loop: name, err: err?.message },
        'TownBrain loop threw — continuing with remaining loops',
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 1: demand — scan resident inventory, queue supply tasks for gaps
  // ──────────────────────────────────────────────────────────────────────

  private demandLoop(town: Town): void {
    const residents = this.townManager.listResidents(this.townId);
    if (residents.length === 0) {
      // Nobody to scan and nobody to give the task to — Phase 3 will queue
      // pickup-by-anyone tasks at this point.
      return;
    }
    const totals = this.aggregateResidentInventory(residents.map((r) => r.botName));
    const thresholds =
      CORE_RESOURCE_THRESHOLDS[town.tier as TownTier] ?? CORE_RESOURCE_THRESHOLDS.founding;

    for (const [resource, threshold] of Object.entries(thresholds)) {
      const have = totals[resource] ?? 0;
      if (have >= threshold) continue;
      const need = threshold - have;
      const role = RESOURCE_ROLE[resource] ?? 'gatherer';
      // Hand the shortage off to the role loop on this tick — it pulls from
      // the idle pool to staff up before the next demand loop runs.
      this.currentTickShortages.push(resource);
      const description = `town:${this.townId} needs ${need} more ${resource} (requesting role: ${role})`;
      // BlackboardManager.addTask requires a Task — we hand it a minimal one;
      // the Voyager loop synthesizes spec/guidance downstream.
      this.blackboard.addTask(
        { description, keywords: [resource, role, 'town', 'supply'] },
        'swarm',
        undefined,
        'normal',
      );
      this.townManager.recordEvent({
        townId: this.townId,
        kind: 'supply:request',
        severity: 'minor',
        payload: { resource, have, need, threshold, role },
        highlightScore: 25,
      });
      logger.info(
        { townId: this.townId, resource, have, need, role },
        'TownBrain demand: queued supply task',
      );
    }
  }

  private aggregateResidentInventory(botNames: string[]): Record<string, number> {
    const totals: Record<string, number> = { wood: 0, stone: 0, food: 0, iron: 0 };
    const wantedSet = botNames.map((n) => n.toLowerCase());
    const workers = this.botManager.getAllWorkers();
    for (const worker of workers) {
      if (!wantedSet.includes(worker.botName.toLowerCase())) continue;
      const status = worker.getCachedStatus?.();
      const inv = (status?.inventory ?? {}) as Record<string, number>;
      for (const [rawName, count] of Object.entries(inv)) {
        if (typeof count !== 'number') continue;
        // Strip the `minecraft:` prefix the worker may or may not include.
        const name = rawName.startsWith('minecraft:') ? rawName.slice(10) : rawName;
        for (const [resource, pattern] of Object.entries(RESOURCE_KEYWORDS)) {
          if (pattern.test(name)) {
            totals[resource] = (totals[resource] ?? 0) + count;
            break;
          }
        }
      }
    }
    return totals;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 2: build — compare town plan to actual buildings, queue gaps
  //
  //  Phase 4: the LLM design path is the PRIMARY route here.
  //    1. Style consultation: load the on-disk style.json.
  //    2. LLM design path: prompt the LLM for a BlockPlan. Validate. Retry
  //       up to 3x on validation failure.
  //    3. Cache successful plans under `schematics/<townId>/<kind>-<hash>`.
  //    4. Style observation feedback: capture realized palette + dims into
  //       style_observations + re-aggregate style.json.
  //    5. Fallback to SchematicMatcher when LLM fails 3x OR the daily budget
  //       cap is hit (config.llmBudgetUsd).
  // ──────────────────────────────────────────────────────────────────────

  private async buildLoop(town: Town): Promise<void> {
    const plan = this.getPlanForTown(town);
    if (plan.length === 0) return;

    const existing = this.townManager.listBuildings(this.townId);

    // Orphan reaper. A 'planned'/'building' row with no resolved origin is a
    // wedged leftover — a build that never started (resolve failure, offline
    // residents, startBuild throw) or a process that died mid-build before the
    // completion hook could resolve the row (e.g. a restart). Ticks are
    // serialized (see tickInFlight), so between ticks there is never a
    // legitimate in-flight queue holding a null-origin row: queuePlanItem runs
    // entirely within one tick and the onStarted hook writes the origin before
    // it returns. A null origin here is therefore unambiguously an orphan.
    // Reap it so it can't hold the in-flight lock and wedge the loop forever.
    const orphans = existing.filter(
      (b) => (b.status === 'planned' || b.status === 'building') && b.origin == null,
    );
    for (const o of orphans) {
      logger.warn(
        { townId: this.townId, buildingId: o.id, name: o.name, status: o.status },
        'TownBrain build: reaping orphaned origin-less building row',
      );
      this.townManager.deleteBuilding(o.id);
    }
    const live = orphans.length > 0
      ? existing.filter((b) => !orphans.some((o) => o.id === b.id))
      : existing;

    // ONE planned-but-not-started building at a time per town. If anything is
    // already 'planned' or 'building' for this town, defer to next tick.
    const inFlight = live.filter(
      (b) => b.status === 'planned' || b.status === 'building',
    );
    if (inFlight.length > 0) {
      logger.debug(
        { townId: this.townId, inFlight: inFlight.length },
        'TownBrain build: a build is already in flight, deferring',
      );
      return;
    }

    // Count what we already have built (or in-flight) per kind. Stored as
    // building.name beginning with the kind id ('town_hall', 'house', ...) —
    // we tag new rows that way in createPlannedBuilding below.
    const haveCounts = this.countBuildingsByKind(live);

    for (const item of plan) {
      const have = haveCounts[item.kind] ?? 0;
      if (have >= item.count) continue;
      if (!item.required) continue;
      await this.queuePlanItem(town, item, live);
      // ONE per tick — bail after we've queued the first gap.
      return;
    }
  }

  private getPlanForTown(town: Town): PlanItem[] {
    const seed = town.styleSeed;
    const tier = (town.tier ?? 'founding') as TownTier;
    if (seed === 'mid-century-civic') return getMidCenturyPlan(tier);
    // Default to medieval-communal when seed is missing or unknown — keeps
    // legacy rows ticking.
    return getMedievalPlan(tier);
  }

  private countBuildingsByKind(buildings: Building[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const b of buildings) {
      if (b.status === 'destroyed') continue;
      // Stored shape: "<kind>:<n>" — see queuePlanItem.
      const name = b.name ?? '';
      const kind = name.includes(':') ? name.split(':')[0] : name;
      if (!kind) continue;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Materialize a missing plan item. Phase 4: try the LLM design path first
   * (cached → fresh design); fall back to the library matcher only when the
   * LLM round-trip fails or the per-day budget is exhausted.
   *
   * Whatever path resolves the schematic, we always insert a `planned`
   * Building row so the next tick's gate skips the same kind.
   */
  private async queuePlanItem(town: Town, item: PlanItem, existingBuildings: Building[]): Promise<void> {
    if (!town.capital) {
      logger.warn(
        { townId: this.townId, kind: item.kind },
        'TownBrain build: town has no capital, cannot queue building',
      );
      return;
    }

    // Resolve connected residents BEFORE creating any row. startBuild rejects
    // the whole job if ANY listed bot is disconnected, so filter to residents
    // whose worker handles report a connected bot. Doing this first means we
    // never create a planned row we can't act on this tick — an unbuildable
    // row would otherwise just sit in the registry holding the in-flight lock.
    const residents = this.townManager.listResidents(this.townId);
    const allNames = residents.map((r) => r.botName);
    const connectedNames: string[] = [];
    for (const n of allNames) {
      const handle = this.botManager.getWorker(n) as { isBotConnected?: () => Promise<boolean> } | undefined;
      if (!handle || typeof handle.isBotConnected !== 'function') continue;
      try {
        if (await handle.isBotConnected()) connectedNames.push(n);
      } catch { /* swallow — treat as disconnected */ }
    }
    if (connectedNames.length === 0) {
      logger.debug(
        { townId: this.townId, residents: allNames.length },
        'TownBrain build: no connected residents to start build with; will retry next tick',
      );
      return;
    }

    const building = this.townManager.createPlannedBuilding({
      townId: this.townId,
      // Stored as "<kind>:<n>" so countBuildingsByKind groups by kind.
      name: `${item.kind}:${Date.now().toString(36)}`,
      schematicSource: 'llm',
      schematicRef: item.schematicQuery,
    });
    this.townManager.recordEvent({
      townId: this.townId,
      kind: 'building:planned',
      severity: 'minor',
      payload: { buildingId: building.id, kind: item.kind, schematicQuery: item.schematicQuery },
      highlightScore: 35,
    });

    // Resolve the schematic file via the LLM design path with fallback.
    const resolved = await this.resolveSchematicForPlanItem(town, item, building, existingBuildings);
    if (!resolved) {
      logger.warn(
        { townId: this.townId, kind: item.kind, buildingId: building.id },
        'TownBrain build: no schematic could be resolved; deleting planned row to avoid wedge',
      );
      // Drop the origin-less row so it can't hold the in-flight lock; the kind
      // is re-queued from scratch next tick.
      this.townManager.deleteBuilding(building.id);
      return;
    }

    logger.info(
      {
        townId: this.townId,
        kind: item.kind,
        buildingId: building.id,
        schematicFile: resolved.schematicFile,
        source: resolved.source,
      },
      'TownBrain build: queuing planned building',
    );

    // Pass to BuildCoordinator with auto-flat origin. The capital coords are
    // the seed for the SiteSelector spiral. The job carries townId/buildingId
    // so its lifecycle hooks can keep the building row in sync:
    //   onStarted   → record the resolved origin + flip to 'building'
    //   onCompleted → flip to 'complete', or delete the row on failure/cancel
    // This is the town↔build linkage: it guarantees the row always advances to
    // a terminal state, so a planned/building row can never orphan and wedge
    // the build loop the way it did before.
    try {
      const job = await this.buildCoordinator.startBuild(
        resolved.schematicFile,
        { x: town.capital.x, y: town.capital.y, z: town.capital.z },
        connectedNames,
        {
          originMode: 'auto-flat',
          townId: this.townId,
          buildingId: building.id,
          onStarted: (j) => {
            // Build actually launched and the origin is resolved. Writing it
            // onto the row (non-null) is what keeps buildLoop's orphan reaper
            // from treating this live build as a leftover.
            this.townManager.recordBuildingPlacement(building.id, {
              origin: j.origin,
              status: 'building',
            });
          },
          onCompleted: (j) => {
            if (j.status === 'completed' || j.status === 'completed_with_errors') {
              this.townManager.updateBuildingStatus(building.id, 'complete');
              logger.info(
                { townId: this.townId, buildingId: building.id, jobId: j.id, status: j.status },
                'TownBrain build: building row marked complete',
              );
            } else {
              logger.warn(
                { townId: this.townId, buildingId: building.id, jobId: j.id, status: j.status },
                'TownBrain build: build did not complete; deleting row for clean re-queue',
              );
              this.townManager.deleteBuilding(building.id);
            }
          },
        },
      );
      this.townManager.recordEvent({
        townId: this.townId,
        kind: 'build:queued',
        severity: 'minor',
        payload: {
          jobId: job.id,
          kind: item.kind,
          schematicFile: resolved.schematicFile,
          buildingId: building.id,
          source: resolved.source,
        },
        highlightScore: 30,
      });
    } catch (err: any) {
      logger.warn(
        { townId: this.townId, kind: item.kind, err: err?.message },
        'TownBrain build: startBuild failed; deleting planned row to avoid wedge',
      );
      // startBuild threw before producing a job (or during pre-build site
      // prep). Delete the row so the kind is retried cleanly next tick instead
      // of leaving a stuck planned/building row.
      this.townManager.deleteBuilding(building.id);
    }
  }

  /**
   * Run the Phase 4 resolution chain for one plan item:
   *   cache → LLM design → SchematicMatcher → bare-filename guess.
   * Returns the schematic filename + source label on success, null when
   * every path failed.
   */
  private async resolveSchematicForPlanItem(
    town: Town,
    item: PlanItem,
    building: Building,
    existingBuildings: Building[],
  ): Promise<{ schematicFile: string; source: 'cache' | 'llm' | 'library' | 'fallback'; plan?: DesignResult } | null> {
    const styleDoc = this.loadTownStyle(town);
    const stylePresetForHash = styleDoc?.seed_style ?? town.styleSeed ?? 'medieval-communal';
    const dims = dimensionsFor(item.kind, styleDoc);
    const hashInput = buildStyleHashInput({
      stylePreset: stylePresetForHash,
      kind: item.kind,
      dimensions: dims,
    });

    // 1) Cache hit — skip the paid LLM call. The JSON cache file lives in
    //    `schematics/<townId>/<kind>-<hash>.json`; followup #44 also writes a
    //    `.schem` companion file at the same path so BuildCoordinator can
    //    swing the LLM's actual geometry. When the companion is present we
    //    return it directly with source='cache'; when it's missing (legacy
    //    JSON-only entry whose lazy re-encode also failed) we fall through to
    //    the library matcher.
    let cacheHit = false;
    let cachedSchemRelPath: string | null = null;
    try {
      const cached = this.designCache.get({
        townId: this.townId,
        kind: item.kind,
        styleHashInput: hashInput,
      });
      if (cached) {
        cacheHit = true;
        if (cached.schemFilename) {
          // BuildCoordinator joins this against `schematics/` so we hand it
          // the `<townId>/<file>` relative path. Using POSIX-style join keeps
          // the schematic filename portable across platforms.
          cachedSchemRelPath = `${this.townId}/${cached.schemFilename}`;
        }
        logger.info(
          {
            townId: this.townId,
            kind: item.kind,
            filename: cached.filename,
            schem: cached.schemFilename ?? null,
          },
          cachedSchemRelPath
            ? 'TownBrain build: design cache hit with .schem companion — using LLM geometry'
            : 'TownBrain build: design cache hit (JSON-only; falling back to library for build)',
        );
        // Observe ONCE on first cache hit during this brain's lifetime so the
        // style doc converges. The cache file's own existence is the
        // long-term store; re-observing every tick double-counts.
        if (!this.observedCacheHashes.has(hashInput)) {
          this.observedCacheHashes.add(hashInput);
          this.styleObserver.observe(town, building, cached.plan);
        }
      }
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId: this.townId, kind: item.kind },
        'TownBrain build: design cache read failed',
      );
    }

    // Cache hit with a buildable .schem? Return now — the LLM's design is
    // ready to swing without paying for a new design call.
    if (cacheHit && cachedSchemRelPath) {
      return { schematicFile: cachedSchemRelPath, source: 'cache' };
    }

    // 2) Daily budget cap.
    const budgetUsd = this.getDailyBudgetUsd(town);
    const budgetKey = this.todayKey();
    const spentToday = this.dailySpendUsd.get(budgetKey) ?? 0;
    const overBudget = budgetUsd != null && spentToday >= budgetUsd;
    if (overBudget && !this.budgetCappedLogged.has(budgetKey)) {
      this.budgetCappedLogged.add(budgetKey);
      this.townManager.recordEvent({
        townId: this.townId,
        kind: 'budget:capped',
        severity: 'minor',
        payload: { spentUsd: spentToday, budgetUsd, day: budgetKey },
        highlightScore: 25,
      });
      logger.info(
        { townId: this.townId, spentToday, budgetUsd },
        'TownBrain build: daily LLM budget cap hit — falling back to library',
      );
    }

    // 3) Fresh LLM design — only if no cache hit and within budget.
    if (this.llmDesigner && !cacheHit && !overBudget) {
      try {
        const neighbors: NeighborContext = {
          neighbors: existingBuildings.slice(-10).map((b) => ({
            name: b.name,
            kind: this.kindFromName(b.name),
            origin: b.origin,
            width: b.width,
            height: b.height,
            depth: b.depth,
          })),
        };
        const design = await this.llmDesigner.designBuilding({
          town,
          plan: item,
          styleDoc,
          neighbors,
        });
        // Update spend ledger (in-memory + persistent file). The save call
        // is failure-isolated inside budgetLedger so a wedged disk doesn't
        // crash the design path.
        this.dailySpendUsd.set(budgetKey, spentToday + design.cost.estUsd);
        this.persistDesignSpend();
        // Cache the plan + encode the .schem companion in one call.
        // Followup #44: when the encode succeeds, BuildCoordinator can swing
        // the LLM's actual geometry; on encode failure we fall through to
        // the library matcher just like before (the JSON cache is still
        // written so introspection/observer keep working).
        const saved = await this.designCache.save(
          { townId: this.townId, kind: item.kind, styleHashInput: hashInput },
          design.plan,
        );
        // Push a style observation so the style doc evolves toward what
        // the LLM actually produced (we observe at design time so even
        // failed builds inform the next prompt).
        this.styleObserver.observe(town, building, design.plan);
        this.townManager.recordEvent({
          townId: this.townId,
          kind: 'building:designed',
          severity: 'info',
          payload: {
            buildingId: building.id,
            kind: item.kind,
            attempts: design.attempts,
            estUsd: design.cost.estUsd,
            blocks: design.plan.blocks.length,
            cacheFile: saved?.filename ?? null,
            schemFile: saved?.schemFilename ?? null,
          },
          highlightScore: 30,
        });
        // Return the .schem path when the encoder succeeded. BuildCoordinator
        // resolves `schematicFile` relative to its `schematics/` root, so we
        // hand it `<townId>/<filename>`. When the encoder failed, fall through
        // to the library matcher below (saved.schemFilename will be null).
        if (saved?.schemFilename) {
          return {
            schematicFile: `${this.townId}/${saved.schemFilename}`,
            source: 'llm',
            plan: design,
          };
        }
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId: this.townId, kind: item.kind },
          'TownBrain build: LLM design failed; falling back to library',
        );
        this.townManager.recordEvent({
          townId: this.townId,
          kind: 'design:failed',
          severity: 'minor',
          payload: { kind: item.kind, error: err?.message ?? 'unknown' },
          highlightScore: 15,
        });
      }
    }

    // 4) Library fallback via SchematicMatcher.
    if (this.schematicMatcher) {
      try {
        const match = this.schematicMatcher.match(item.schematicQuery, {
          style: town.styleSeed ?? undefined,
        });
        if (match) {
          return { schematicFile: match.filename, source: 'library' };
        }
      } catch (err: any) {
        logger.warn(
          { err: err?.message, kind: item.kind },
          'TownBrain build: SchematicMatcher.match threw',
        );
      }
    }

    // 5) Bare-filename guess (current Phase 2 behavior). Most likely fails
    //    BuildCoordinator's existsSync check, but keeps the original
    //    fallback path for tests that pre-create `<query>.schem`.
    return {
      schematicFile: `${item.schematicQuery}.schem`,
      source: 'fallback',
    };
  }

  /** Lazy-load the style.json. Returns null when the file is missing. */
  private loadTownStyle(town: Town): StyleDoc | null {
    const dataDir = this.townManager.getDataDir?.() ?? path.join(process.cwd(), 'data');
    return loadStyle(dataDir, town.id);
  }

  /** UTC yyyy-mm-dd key for the daily LLM spend ledger. */
  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Followup #45 — flush the in-memory design-spend map to disk.
   * Followup #64 — writes only the design slice into its own file so a
   * concurrent chronicle save can no longer clobber the design slice (or
   * vice versa) around the LLM call window. Failures are swallowed inside
   * budgetLedger.saveDesign.
   */
  private persistDesignSpend(): void {
    try {
      const dataDir = this.townManager.getDataDir?.() ?? path.join(process.cwd(), 'data');
      const designSpendUsdByDay: Record<string, number> = {};
      for (const [day, usd] of this.dailySpendUsd.entries()) {
        designSpendUsdByDay[day] = usd;
      }
      budgetLedger.saveDesign(dataDir, this.townId, { designSpendUsdByDay });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId: this.townId },
        'TownBrain: persistDesignSpend threw; continuing with in-memory state',
      );
    }
  }

  /** Pull the per-day USD ceiling out of town.config; null when not set. */
  private getDailyBudgetUsd(town: Town): number | null {
    const cfg = town.config ?? {};
    const llmBudget = (cfg as any).llmBudgetUsd;
    if (typeof llmBudget === 'number' && llmBudget > 0) return llmBudget;
    return null;
  }

  /** Extract the kind from a stored `<kind>:<suffix>` building name. */
  private kindFromName(name: string | null): string | null {
    if (!name) return null;
    const idx = name.indexOf(':');
    return idx > 0 ? name.slice(0, idx) : name;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 3: role — RoleManager re-balances residents.current_role each tick
  // ──────────────────────────────────────────────────────────────────────

  private roleLoop(town: Town): void {
    const residents = this.townManager
      .listResidents(this.townId)
      .filter((r) => r.status === 'alive' || r.status == null);

    // Population shortfall — keep emitting role:imbalance so observers know a
    // founding settlement still wants more bots. RoleManager won't conjure
    // residents, it only re-shuffles the ones that exist.
    const target = town.populationTarget ?? this.defaultPopulationTarget(town);
    if (residents.length < target) {
      const shortfall = target - residents.length;
      this.townManager.recordEvent({
        townId: this.townId,
        kind: 'role:imbalance',
        severity: 'minor',
        payload: {
          currentPopulation: residents.length,
          target,
          shortfall,
          wantsMoreBots: true,
        },
        highlightScore: 20,
      });
      logger.debug(
        { townId: this.townId, residents: residents.length, target },
        'TownBrain role: population under target',
      );
    }

    // Re-balance roles using shortages flagged on this tick by the demand
    // loop. The RoleManager mutates residents.current_role via TownManager
    // and returns the list of changes so we can emit role:assigned events.
    const changes = this.roleManager.assignRoles(this.townId, this.currentTickShortages);
    for (const change of changes) {
      this.townManager.recordEvent({
        townId: this.townId,
        kind: 'role:assigned',
        severity: 'info',
        payload: change,
        highlightScore: 15,
      });
    }
    if (changes.length > 0) {
      logger.info(
        { townId: this.townId, changes: changes.length },
        'TownBrain role: re-balanced',
      );
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 4: schedule — push day/night role tasks onto the swarm board
  // ──────────────────────────────────────────────────────────────────────

  private scheduleLoop(_town: Town): void {
    const worldTicks = this.readWorldTimeTicks();
    this.scheduleManager.tick(this.townId, worldTicks);
  }

  /**
   * Cheapest path to Minecraft world time: ask the first worker's cached
   * detailed status. BotManager already polls this; we read whatever's in
   * the cache (no new IPC). Null when no bots are online — ScheduleManager
   * falls back to a system-clock guess so the cycle keeps moving.
   */
  private readWorldTimeTicks(): number | null {
    const workers = this.botManager.getAllWorkers();
    for (const worker of workers) {
      const detailed = worker.getCachedDetailedStatus?.();
      const ticks = detailed?.world?.timeOfDayTicks;
      if (typeof ticks === 'number') return ticks;
    }
    return null;
  }

  private defaultPopulationTarget(town: Town): number {
    // Mirror the tier table in TOWN_BUILDER_SPEC.md §3. The brain uses the
    // floor of each tier's range so "under target" fires early.
    switch (town.tier) {
      case 'town':
        return 8;
      case 'village':
        return 3;
      case 'founding':
      default:
        return 1;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 5: threat — Phase 5 stub. No-op until threat aggregation lands;
  //  emitting a tick event every 60s would flood the events table.
  // ──────────────────────────────────────────────────────────────────────

  private threatLoop(_town: Town): void {
    // Intentionally empty — Phase 5 wires this up to mob/player scans.
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 6 (Phase 5-A): phoenix — self-heal damaged/destroyed buildings,
  //  record disasters when residents die, and stamp Memorial Park monuments.
  //
  //  The PhoenixManager owns the per-town in-memory ledgers + the
  //  DisasterRecorder / MemorialPark sub-objects. queueRepairs() is fully
  //  idempotent so repeated ticks never double-queue.
  // ──────────────────────────────────────────────────────────────────────

  private async phoenixLoop(_town: Town): Promise<void> {
    await this.phoenixManager.queueRepairs(this.townId);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 7 (Phase 5-B): district — manage style evolution as the town grows
  //
  //  Two responsibilities per tick:
  //    1. Detect a tier transition (village → town) and let DistrictManager
  //       seed the *opposite* style preset's district so the town evolves
  //       from medieval village → mid-century downtown (or vice versa).
  //    2. Back-fill `districtId` on any in-flight building rows so the
  //       LLM design pipeline can scope its style.json lookup to a
  //       district rather than the whole town. This is the integration
  //       seam with P4-A's LlmDesigner.
  // ──────────────────────────────────────────────────────────────────────

  private districtLoop(town: Town): void {
    // 1) Tier-up hook. We compare the previous tick's snapshot to the
    //    current tier. `onTierUpgrade` is idempotent (checks existing
    //    district count) so a duplicate fire is harmless.
    const currentTier = town.tier ?? 'founding';
    const prev = this.lastSeenTier;
    if (prev !== null && prev !== currentTier) {
      try {
        this.districtManager.onTierUpgrade(this.townId, prev as TownTier, currentTier);
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId: this.townId, prev, currentTier },
          'TownBrain district: onTierUpgrade threw',
        );
      }
    }
    this.lastSeenTier = currentTier;

    // 2) District-aware building back-fill. When the town has 2+ districts
    //    we route in-flight (planned + building) rows that lack a
    //    districtId into the active district for their kind. Buildings
    //    already tagged stay untouched.
    const districts = this.districtManager.listDistricts(this.townId);
    if (districts.length < 2) return; // single-district towns don't need routing

    const buildings = this.townManager.listBuildings(this.townId);
    for (const b of buildings) {
      if (b.districtId) continue;
      if (b.status !== 'planned' && b.status !== 'building') continue;
      const kind = this.kindFromName(b.name) ?? '';
      const target = this.districtManager.getActiveDistrictFor(this.townId, kind);
      if (!target) continue;
      const ok = this.townManager.setBuildingDistrict(b.id, target.id);
      if (ok) {
        this.townManager.recordEvent({
          townId: this.townId,
          kind: 'district:building_routed',
          severity: 'info',
          payload: { buildingId: b.id, districtId: target.id, kind },
          highlightScore: 15,
        });
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 8 (Phase 5-B): expansion — propose + spawn child towns
  //
  //  Caps:
  //    - 1 child per tick (proposeExpansion short-circuits past the cap).
  //    - Daily proposal counter inside ExpansionManager (default 1/day).
  //    - First child auto-approves; subsequent proposals require Phase 6
  //      approval flow and only emit `expansion:pending_approval`.
  // ──────────────────────────────────────────────────────────────────────

  private expansionLoop(town: Town): void {
    const proposal = this.expansionManager.proposeExpansion(town);
    if (!proposal) return;
    if (!proposal.autoApprove) return; // pending_approval already emitted
    this.expansionManager.executeProposal(proposal);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 9 (Phase 6-B): approval — drive the approvals queue forward
  //
  //  Two responsibilities per tick:
  //    1. When the town is in 'vote' mode, run the heuristic vote (see
  //       VoteHeuristic.ts) for every alive resident on every open approval.
  //       Idempotent — castVote only fires for residents who haven't already
  //       voted on each approval.
  //    2. Tally every open approval. tally() resolves the row when the
  //       deadline passes (mode='mayor' → expired, mode='vote' → majority).
  //       Approved rows fire the resolveOnce handler the proposer registered
  //       at create time (e.g. ExpansionManager.executeProposal).
  // ──────────────────────────────────────────────────────────────────────

  private async approvalLoop(town: Town): Promise<void> {
    const open = this.approvalManager.listOpen(town.id);
    if (open.length === 0) return;

    // 1) Heuristic votes when configured. We only build the resident vector
    //    when needed since it requires walking BotManager workers.
    const cfg = (town.config ?? {}) as { approvalMode?: 'mayor' | 'vote' };
    if (cfg.approvalMode === 'vote') {
      const residents = this.townManager.listResidents(this.townId);
      // Look up each resident's personality from their worker handle. Bots
      // who aren't currently online (worker missing) still vote — the worker
      // lookup is just for the personality string. Fall back to '' when a
      // worker doesn't exist.
      const workersByName = new Map<string, string>();
      for (const w of this.botManager.getAllWorkers()) {
        workersByName.set(w.botName.toLowerCase(), w.personality);
      }
      const voters = residents.map((r) => ({
        botName: r.botName,
        personality: workersByName.get(r.botName.toLowerCase()) ?? null,
        alive: r.status === 'alive' || r.status == null,
      }));
      this.approvalManager.castHeuristicVotes(this.townId, voters);
    }

    // 2) Tally every open approval. tally() is a no-op for rows whose
    //    expiresAt is still in the future, and returns the same row when
    //    nothing changed. Failures are isolated per-approval so one bad
    //    row doesn't block the rest.
    for (const approval of open) {
      try {
        await this.approvalManager.tally(approval.id);
      } catch (err: any) {
        logger.warn(
          { err: err?.message, approvalId: approval.id, townId: this.townId },
          'TownBrain approval: tally threw',
        );
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 10 (Phase 7-A): diplomacy — scan cross-town events + auto-transition
  //
  //  Two responsibilities:
  //    1. Walk peer towns within DIPLOMACY_PEER_RADIUS_BLOCKS. For each
  //       peer, scan recent events on BOTH sides since the last cursor and
  //       fire the Phase-7 trigger checks:
  //         - expansion:founded landing within DIPLOMACY_BORDER_DISTANCE_BLOCKS
  //           of a peer capital → border_violation (this town hostile).
  //         - disaster (kind 'lost_bot') near a peer's bots → suspicion.
  //         - mayor:decree text that mentions a peer's name → peace_overture.
  //    2. After triggers settle, call diplomacyManager.applyAutoTransitions
  //       for this town's outgoing edges so the sustain counter advances.
  //
  //  Idempotency: every recordInteraction is gated by a per-(pair, kind)
  //  cooldown of DIPLOMACY_TRIGGER_COOLDOWN_MS (~10 minutes) so duplicate
  //  events in the same window don't re-fire the same delta. Cursor avoids
  //  re-scanning events between ticks.
  // ──────────────────────────────────────────────────────────────────────

  private diplomacyLoop(town: Town): void {
    if (!town.capital) return;
    const peers = this.findDiplomacyPeers(town);
    if (peers.length === 0) {
      // Still advance auto-transitions so an admin override can settle even
      // when no peers are nearby.
      this.diplomacyManager.applyAutoTransitions(town.id);
      this.diplomacyEventCursor = Date.now();
      return;
    }

    // 1) Trigger checks — gather recent local + peer events ONCE per tick,
    //    then dispatch per peer. The event window is `(cursor .. now]`.
    const since = this.diplomacyEventCursor;
    const now = Date.now();
    const localEvents = this.townManager.listEvents(town.id, { limit: 200, since });

    for (const peer of peers) {
      this.runDiplomacyTriggers(town, peer, localEvents);
    }

    // 2) Auto-transitions for every outgoing edge owned by this town.
    this.diplomacyManager.applyAutoTransitions(town.id);

    // Advance the cursor at the very end so a thrown trigger doesn't skip
    // the same event window on the next tick.
    this.diplomacyEventCursor = now;
  }

  /**
   * Find every other active town whose capital lies within
   * DIPLOMACY_PEER_RADIUS_BLOCKS of `self.capital`. Excludes `self`,
   * abandoned/dormant towns, and towns with a null capital.
   */
  private findDiplomacyPeers(self: Town): Town[] {
    if (!self.capital) return [];
    const peers: Town[] = [];
    for (const candidate of this.townManager.listTowns()) {
      if (candidate.id === self.id) continue;
      if (candidate.status !== 'active') continue;
      if (!candidate.capital) continue;
      const dx = candidate.capital.x - self.capital.x;
      const dz = candidate.capital.z - self.capital.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance <= DIPLOMACY_PEER_RADIUS_BLOCKS) {
        peers.push(candidate);
      }
    }
    return peers;
  }

  /** Apply each Phase-7 trigger to (this town, peer) using recent local events. */
  private runDiplomacyTriggers(
    town: Town,
    peer: Town,
    localEvents: TownEvent[],
  ): void {
    if (!peer.capital) return;
    for (const ev of localEvents) {
      switch (ev.kind) {
        case 'expansion:founded': {
          // Payload shape: { childTownId, childName, childCapital, ... }.
          // Re-resolve the child town for its real capital so we don't trust
          // the embedded payload blindly (the child may have moved since).
          const payload = (ev.payload ?? {}) as {
            childCapital?: { x: number; y: number; z: number };
            childTownId?: string;
          };
          const childCapital = payload.childCapital ?? null;
          if (!childCapital) break;
          const dx = childCapital.x - peer.capital.x;
          const dz = childCapital.z - peer.capital.z;
          const distance = Math.sqrt(dx * dx + dz * dz);
          if (distance <= DIPLOMACY_BORDER_DISTANCE_BLOCKS) {
            this.fireDiplomacyTrigger(town.id, peer.id, 'border_violation', {
              eventId: ev.id,
              childTownId: payload.childTownId ?? null,
              distance: Math.round(distance),
              radius: DIPLOMACY_BORDER_DISTANCE_BLOCKS,
            });
          }
          break;
        }
        case 'disaster': {
          // Phoenix records `kind: 'disaster'` events with payload.kind
          // = 'lost_bot' etc. Suspicion fires when a lost_bot disaster
          // happens near a peer's footprint — Phase 7 keeps it simple and
          // uses the peer's capital as the proxy for 'near a peer's bots'.
          const payload = (ev.payload ?? {}) as { kind?: string };
          if (payload.kind !== 'lost_bot') break;
          // Use the radius check from findDiplomacyPeers — we already know
          // the peer is within DIPLOMACY_PEER_RADIUS_BLOCKS, so a lost_bot
          // anywhere in this town counts as 'near'.
          this.fireDiplomacyTrigger(town.id, peer.id, 'suspicion', {
            eventId: ev.id,
            disasterKind: payload.kind,
          });
          break;
        }
        case 'mayor:decree': {
          // Payload shape: { taskId, text, source: 'mayor_directive' }.
          const payload = (ev.payload ?? {}) as { text?: string };
          const text = typeof payload.text === 'string' ? payload.text : '';
          if (!text) break;
          if (this.decreeMentionsTown(text, peer.name)) {
            this.fireDiplomacyTrigger(town.id, peer.id, 'peace_overture', {
              eventId: ev.id,
              snippet: text.slice(0, 120),
            });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Word-boundary case-insensitive substring check so 'Allied with Riverwood'
   * matches peer name 'Riverwood' but 'Riverwood-East' (a child town) does
   * not. The regex escape keeps mayor decrees with regex metacharacters in
   * a peer name from blowing up the brain.
   */
  private decreeMentionsTown(text: string, townName: string): boolean {
    if (!townName) return false;
    const escaped = townName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    return re.test(text);
  }

  /**
   * Apply the (townIdPair, kind) cooldown gate and forward to
   * DiplomacyManager.recordInteraction. Returns true when the interaction
   * actually fired this tick (cooldown miss → false).
   */
  private fireDiplomacyTrigger(
    fromTownId: string,
    toTownId: string,
    kind: InteractionKind,
    payload?: unknown,
  ): boolean {
    const key = `${fromTownId}|${toTownId}|${kind}`;
    const now = Date.now();
    const nextEligible = this.diplomacyCooldowns.get(key) ?? 0;
    if (now < nextEligible) return false;
    this.diplomacyCooldowns.set(key, now + DIPLOMACY_TRIGGER_COOLDOWN_MS);
    try {
      this.diplomacyManager.recordInteraction(fromTownId, toTownId, kind, payload);
      return true;
    } catch (err: any) {
      logger.warn(
        { err: err?.message, fromTownId, toTownId, kind },
        'TownBrain diplomacy: recordInteraction threw',
      );
      return false;
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 11 (Phase 6-A): greeting — say hi to the mayor when in range
  //
  //  The dispatcher reads each resident's WorkerHandle, asks it for the
  //  live player list, and queues a chat IPC when a player is within 16
  //  blocks AND the (bot, player) cooldown is clear. Mayor lookup +
  //  cooldown state both live on the shared MayorService.
  // ──────────────────────────────────────────────────────────────────────

  private async greetingLoop(town: Town): Promise<void> {
    await this.greetingDispatcher.tick(town.id);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 11 (Phase 7-B): trade — allied-town surplus/shortage routes
  //
  //  Pulls the diplomacy graph from TownManager (P7-A); for every allied
  //  peer with a shortage of a resource this town has surplus of, queue a
  //  swarm-priority blackboard delivery task. The TradeRouteManager owns
  //  the per-(source, target, resource) cooldown so a route doesn't get
  //  re-queued on every tick.
  //
  //  The actual delivery is left to the existing Voyager loop +
  //  supply-chain infrastructure. Phase 7 is purely the trigger layer.
  // ──────────────────────────────────────────────────────────────────────

  private tradeLoop(town: Town): void {
    this.tradeRouteManager.tick(town.id);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Loop 12 (Phase 7-B): rival — periodic patrol-ramp signal
  //
  //  Every RIVAL_PATROL_TICK_INTERVAL ticks (~5 minutes at 60s cadence)
  //  walk the diplomacy graph and emit a `rival:patrol` event for each
  //  rival peer. Phase 7 just emits the signal; actual guard-behavior
  //  changes are out of scope.
  //
  //  The signal carries the rival town id + name so a Phase 8 guard
  //  policy can scope its patrol up-tempo to that border. The cooldown
  //  lives on the brain's tickCount so a manual runTick() in tests still
  //  honors the 5-tick spacing.
  // ──────────────────────────────────────────────────────────────────────

  private rivalLoop(town: Town): void {
    if (this.tickCount % RIVAL_PATROL_TICK_INTERVAL !== 0) return;
    const tm = this.townManager as unknown as {
      getDiplomacyManager?: () => {
        listOutgoing?: (
          townId: string,
        ) => Array<{ townIdA?: string; townIdB?: string; peerTownId?: string; state: string }>;
      } | null;
    };
    if (typeof tm.getDiplomacyManager !== 'function') return;
    let dm: ReturnType<NonNullable<typeof tm.getDiplomacyManager>> | null = null;
    try {
      dm = tm.getDiplomacyManager() ?? null;
    } catch {
      return;
    }
    if (!dm || typeof dm.listOutgoing !== 'function') return;
    let edges: Array<{ townIdA?: string; townIdB?: string; peerTownId?: string; state: string }> = [];
    try {
      edges = dm.listOutgoing(town.id) ?? [];
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId: town.id },
        'TownBrain rival: listOutgoing threw',
      );
      return;
    }
    const rivals = edges.filter((e) => e?.state === 'rival');
    if (rivals.length === 0) return;
    for (const edge of rivals) {
      // P7-A's Relationship shape uses (townIdA, townIdB). Derive the peer
      // as whichever side isn't this town.
      const peerTownId =
        edge.peerTownId ??
        (edge.townIdA === town.id ? edge.townIdB : edge.townIdA);
      if (!peerTownId) continue;
      const peer = this.townManager.getTown(peerTownId);
      if (!peer) continue;
      this.townManager.recordEvent({
        townId: town.id,
        kind: 'rival:patrol',
        severity: 'minor',
        payload: {
          rivalTownId: peer.id,
          rivalTownName: peer.name,
          // Best-effort hint at the border bearing — guards may consume this
          // later. Null when either capital is missing (legacy rows).
          bearing:
            town.capital && peer.capital
              ? {
                  dx: peer.capital.x - town.capital.x,
                  dz: peer.capital.z - town.capital.z,
                }
              : null,
        },
        highlightScore: 20,
      });
      logger.info(
        { townId: town.id, rivalTownId: peer.id },
        'TownBrain rival: emitted rival:patrol signal',
      );
    }
  }
}
