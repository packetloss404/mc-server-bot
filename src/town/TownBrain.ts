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
import type { Building, Town } from './Town';
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
import { GreetingDispatcher } from './GreetingDispatcher';
import type { MayorService } from './MayorService';
import { logger } from '../util/logger';

const TICK_INTERVAL_MS = 60_000;

/**
 * Phase-2 hardcoded core-resource thresholds. Tier-keyed so a village needs
 * more wood than a founding settlement. Phase 5 makes these dynamic.
 */
const CORE_RESOURCE_THRESHOLDS: Record<TownTier, Record<string, number>> = {
  founding: { wood: 32, stone: 16, food: 8, iron: 0 },
  village: { wood: 128, stone: 64, food: 32, iron: 8 },
  town: { wood: 384, stone: 256, food: 96, iron: 32 },
};

/** Keyword groups used to bucket inventory items into core resources. */
const RESOURCE_KEYWORDS: Record<string, RegExp> = {
  wood: /(_log|_planks|_wood$|^stripped_)/,
  stone: /(^stone$|^cobblestone$|^andesite$|^granite$|^diorite$|_stone$)/,
  food: /(bread|wheat|carrot|potato|beetroot|melon|apple|mutton|beef|chicken|cooked|porkchop|fish|cod|salmon|berries)/,
  iron: /(^iron_ingot$|^iron_ore$|^raw_iron$|^iron_block$)/,
};

/** Default suggested role for each resource shortage (Phase 3 hooks roles). */
const RESOURCE_ROLE: Record<string, string> = {
  wood: 'lumberjack',
  stone: 'miner',
  food: 'farmer',
  iron: 'blacksmith',
};

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
    // ONE planned-but-not-started building at a time per town. If anything is
    // already 'planned' or 'building' for this town, defer to next tick.
    const inFlight = existing.filter(
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
    const haveCounts = this.countBuildingsByKind(existing);

    for (const item of plan) {
      const have = haveCounts[item.kind] ?? 0;
      if (have >= item.count) continue;
      if (!item.required) continue;
      await this.queuePlanItem(town, item, existing);
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
        'TownBrain build: no schematic could be resolved; planned row stays for retry',
      );
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

    // Best-effort: pass to BuildCoordinator with auto-flat origin. The
    // capital coords are the seed for the SiteSelector spiral.
    try {
      const residents = this.townManager.listResidents(this.townId);
      const botNames = residents.map((r) => r.botName);
      if (botNames.length === 0) {
        // A town with zero residents still has town plan rows. The build
        // will be queued for real on a tick where residents exist.
        return;
      }
      const job = await this.buildCoordinator.startBuild(
        resolved.schematicFile,
        { x: town.capital.x, y: town.capital.y, z: town.capital.z },
        botNames,
        { originMode: 'auto-flat' },
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
        'TownBrain build: startBuild failed (row stays planned, will retry)',
      );
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
    //    `schematics/<townId>/<kind>-<hash>.json`. BuildCoordinator today
    //    only loads `.schem` files; we still need to fall through to the
    //    library fallback for a buildable file, but we MUST NOT re-run the
    //    LLM or re-observe the style on every tick. Once the JSON→.schem
    //    encoder lands, return the cached.filename here directly.
    let cacheHit = false;
    try {
      const cached = this.designCache.get({
        townId: this.townId,
        kind: item.kind,
        styleHashInput: hashInput,
      });
      if (cached) {
        cacheHit = true;
        logger.info(
          { townId: this.townId, kind: item.kind, filename: cached.filename },
          'TownBrain build: design cache hit (JSON-only; library fallback used for build)',
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
        // Update spend ledger.
        this.dailySpendUsd.set(budgetKey, spentToday + design.cost.estUsd);
        // Cache the plan; record an event with the attempts/cost for telemetry.
        const saved = this.designCache.save(
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
          },
          highlightScore: 30,
        });
        // Even though we now have a JSON block plan, BuildCoordinator can
        // only swing `.schem` files today. Fall through to library to pick
        // an actual buildable file — but we've already saved the plan and
        // observed the style. The JSON→schem encoder is a TODO; once
        // landed, swap the return here to use the cached file path.
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
  //  Loop 10 (Phase 6-A): greeting — say hi to the mayor when in range
  //
  //  The dispatcher reads each resident's WorkerHandle, asks it for the
  //  live player list, and queues a chat IPC when a player is within 16
  //  blocks AND the (bot, player) cooldown is clear. Mayor lookup +
  //  cooldown state both live on the shared MayorService.
  // ──────────────────────────────────────────────────────────────────────

  private async greetingLoop(town: Town): Promise<void> {
    await this.greetingDispatcher.tick(town.id);
  }
}
