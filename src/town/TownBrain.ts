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
import type { TownManager } from './TownManager';
import type { BotManager } from '../bot/BotManager';
import type { BuildCoordinator } from '../build/BuildCoordinator';
import type { BlackboardManager } from '../voyager/BlackboardManager';
import type { Building, Town } from './Town';
import type { PlanItem, TownTier } from './PlanItem';
import { getRequiredBuildings as getMedievalPlan } from './seed/medieval';
import { getRequiredBuildings as getMidCenturyPlan } from './seed/midcentury';
import { RoleManager } from './RoleManager';
import { ScheduleManager } from './ScheduleManager';
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

  constructor(
    townId: string,
    townManager: TownManager,
    botManager: BotManager,
    buildCoordinator: BuildCoordinator,
    blackboard: BlackboardManager,
    opts: { intervalMs?: number; roleManager?: RoleManager; scheduleManager?: ScheduleManager } = {},
  ) {
    this.townId = townId;
    this.townManager = townManager;
    this.botManager = botManager;
    this.buildCoordinator = buildCoordinator;
    this.blackboard = blackboard;
    this.intervalMs = opts.intervalMs ?? TICK_INTERVAL_MS;
    this.roleManager = opts.roleManager ?? new RoleManager(townManager, botManager);
    this.scheduleManager = opts.scheduleManager ?? new ScheduleManager(townManager, blackboard);
  }

  /** Exposed so TownManager (and the API) can call assignment outside the tick. */
  getRoleManager(): RoleManager {
    return this.roleManager;
  }

  /** Exposed so the API can read the schedule table for the dashboard. */
  getScheduleManager(): ScheduleManager {
    return this.scheduleManager;
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
      await this.queuePlanItem(town, item);
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
   * Materialize a missing plan item: insert a `planned` Building row and
   * queue a build job. With the row in place, the next tick's
   * `inFlight`/`haveCounts` checks correctly skip this kind, so the brain
   * does not re-queue the same plan item every 60s. Phase 4 will wire
   * SchematicMatcher + LLM design here; for now we hand the schematicQuery
   * straight to BuildCoordinator and accept that startBuild may throw if no
   * matching file exists.
   */
  private async queuePlanItem(town: Town, item: PlanItem): Promise<void> {
    if (!town.capital) {
      logger.warn(
        { townId: this.townId, kind: item.kind },
        'TownBrain build: town has no capital, cannot queue building',
      );
      return;
    }
    const schematicFile = `${item.schematicQuery}.schem`;
    const building = this.townManager.createPlannedBuilding({
      townId: this.townId,
      // Stored as "<kind>:<n>" so countBuildingsByKind groups by kind.
      name: `${item.kind}:${Date.now().toString(36)}`,
      schematicSource: 'library',
      schematicRef: item.schematicQuery,
    });
    this.townManager.recordEvent({
      townId: this.townId,
      kind: 'building:planned',
      severity: 'minor',
      payload: { buildingId: building.id, kind: item.kind, schematicQuery: item.schematicQuery },
      highlightScore: 35,
    });

    logger.info(
      { townId: this.townId, kind: item.kind, buildingId: building.id, schematicFile },
      'TownBrain build: queuing planned building',
    );

    // Best-effort: pass to BuildCoordinator with auto-flat origin. The
    // capital coords are the seed for the SiteSelector spiral. If no bots
    // exist (or no schematic file matches), startBuild throws — we catch +
    // record the planned row and try again next tick.
    try {
      // Build coordinator wants at least one bot name. If we have no
      // residents, queue the planned-row only — the build itself will fire
      // once bots exist on a later tick.
      const residents = this.townManager.listResidents(this.townId);
      const botNames = residents.map((r) => r.botName);
      if (botNames.length === 0) {
        // Phase 2: a town with zero residents still has town plan rows. The
        // build will be queued for real on a tick where residents exist.
        return;
      }
      const job = await this.buildCoordinator.startBuild(
        schematicFile,
        { x: town.capital.x, y: town.capital.y, z: town.capital.z },
        botNames,
        { originMode: 'auto-flat' },
      );
      this.townManager.recordEvent({
        townId: this.townId,
        kind: 'build:queued',
        severity: 'minor',
        payload: { jobId: job.id, kind: item.kind, schematicFile, buildingId: building.id },
        highlightScore: 30,
      });
    } catch (err: any) {
      // Schematic missing, no bots ready, etc. The planned row stays in
      // place so the next tick's gate skips this kind. Phase 4 will mark
      // the row 'destroyed' on persistent failure so the brain can pick a
      // different schematic; for now leaving it 'planned' is fine.
      logger.warn(
        { townId: this.townId, kind: item.kind, err: err?.message },
        'TownBrain build: startBuild failed (row stays planned, will retry)',
      );
    }
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
}
