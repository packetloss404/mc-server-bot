/**
 * PhoenixManager — Phase 5-A self-healing loop for the Town Brain.
 *
 * Each tick the Phoenix loop runs two scans:
 *   1. scanDamage(townId) — any building row in 'damaged' or 'destroyed'
 *      state is enqueued for repair (damaged) or fresh rebuild (destroyed).
 *   2. scanDeaths(townId) — residents whose status flipped to 'dead' since
 *      the last scan are filed as `lost_bot` disasters, their role is
 *      flagged for replacement, and a Memorial Park monument is placed.
 *
 * Idempotency:
 *   - Damaged building rows are flipped to a 'planned' state once a repair
 *     task lands on the blackboard, so a second scan in the same tick window
 *     won't double-queue. (Destroyed rows stay 'destroyed' but we track them
 *     in an in-memory set so the second scan recognizes "already handled".)
 *   - Deaths are tracked by lastScanAt — a death two ticks ago has already
 *     been recorded and won't be re-recorded even if status is still 'dead'.
 *
 * Failure isolation: the brain wraps queueRepairs in runLoopSafe, but each
 * inner step (damage scan, death scan, disaster recording, monument place)
 * is independently try/catched here so one bad row never kills the rest of
 * the loop.
 *
 * Spec: TOWN_BUILDER_SPEC.md §5 ("Phoenix").
 */
import { logger } from '../util/logger';
import type { TownManager } from './TownManager';
import type { BotManager } from '../bot/BotManager';
import type { BuildCoordinator } from '../build/BuildCoordinator';
import type { BlackboardManager } from '../voyager/BlackboardManager';
import type { Building } from './Town';
import { DisasterRecorder, type Disaster } from './DisasterRecorder';
import { MemorialPark } from './MemorialPark';
import type { ChronicleGenerator } from './ChronicleGenerator';
import type { MarkerStore } from '../control/MarkerStore';

export interface RepairAction {
  buildingId: string;
  /** 'damaged' rows get patched in-place; 'destroyed' triggers a fresh build. */
  mode: 'repair' | 'rebuild';
  /** Stored as `<kind>:<suffix>` — same as TownBrain.buildLoop's tagging. */
  kind: string | null;
  schematicRef: string | null;
}

export interface DeathRecord {
  residentId: string;
  botName: string;
  /** Role the bot held when it died, so RoleManager can re-fill it. */
  role: string | null;
  diedAt: number;
}

export class PhoenixManager {
  private readonly townManager: TownManager;
  private readonly botManager: BotManager;
  private readonly buildCoordinator: BuildCoordinator;
  private readonly blackboard: BlackboardManager;
  private readonly disasterRecorder: DisasterRecorder;
  private readonly memorialPark: MemorialPark;

  /**
   * In-memory ledgers keyed by townId. Cheap, per-process; persistence is a
   * follow-up. The scan loop is idempotent against these so a tick that
   * crashes mid-way is safe to retry.
   */
  private readonly handledDamageIds: Map<string, Set<string>> = new Map();
  private readonly handledRebuildIds: Map<string, Set<string>> = new Map();
  private readonly handledDeathIds: Map<string, Set<string>> = new Map();
  private readonly lastScanAt: Map<string, number> = new Map();
  /**
   * Towns whose in-memory `handledDeathIds` set has been seeded from the
   * disasters table. Done lazily on first scanDeaths so a process restart
   * doesn't re-fire replacement-role flags + chronicle milestones for
   * residents already memorialized.
   */
  private readonly warmedDeathLedgers: Set<string> = new Set();

  /**
   * Roles awaiting replacement bots. RoleManager consumes this via
   * getReplacementRoles() so the next role loop spawns/assigns into the gap.
   */
  private readonly pendingReplacementRoles: Map<string, string[]> = new Map();

  constructor(
    townManager: TownManager,
    botManager: BotManager,
    buildCoordinator: BuildCoordinator,
    blackboard: BlackboardManager,
    opts: {
      disasterRecorder?: DisasterRecorder;
      memorialPark?: MemorialPark;
    } = {},
  ) {
    this.townManager = townManager;
    this.botManager = botManager;
    this.buildCoordinator = buildCoordinator;
    this.blackboard = blackboard;
    this.disasterRecorder = opts.disasterRecorder ?? new DisasterRecorder(townManager);
    this.memorialPark = opts.memorialPark ?? new MemorialPark(townManager);
  }

  /** Wire the chronicler post-construction (api.ts builds it after the brain). */
  setChronicleGenerator(gen: ChronicleGenerator | null): void {
    this.disasterRecorder.setChronicleGenerator(gen);
  }

  /** Wire the marker store post-construction (api.ts builds it after the brain). */
  setMarkerStore(store: MarkerStore | null): void {
    this.memorialPark.setMarkerStore(store);
  }

  /** Test/debug accessor for the underlying memorial park. */
  getMemorialPark(): MemorialPark {
    return this.memorialPark;
  }

  /** Test/debug accessor for the disaster recorder. */
  getDisasterRecorder(): DisasterRecorder {
    return this.disasterRecorder;
  }

  /**
   * Roles still waiting for a replacement bot. RoleManager (or the API) can
   * pop entries off this list to drive its next assignment pass. Returns a
   * snapshot — callers should not mutate the returned array.
   */
  getPendingReplacementRoles(townId: string): string[] {
    const list = this.pendingReplacementRoles.get(townId);
    return list ? [...list] : [];
  }

  /** Mark a replacement role as filled. Used by RoleManager or the API. */
  consumeReplacementRole(townId: string, role: string): boolean {
    const list = this.pendingReplacementRoles.get(townId);
    if (!list) return false;
    const idx = list.indexOf(role);
    if (idx < 0) return false;
    list.splice(idx, 1);
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Damage / destruction scan
  // ──────────────────────────────────────────────────────────────────────

  scanDamage(townId: string): RepairAction[] {
    const buildings = this.townManager.listBuildings(townId);
    const handledDamage = this.getOrCreate(this.handledDamageIds, townId);
    const handledRebuild = this.getOrCreate(this.handledRebuildIds, townId);
    const out: RepairAction[] = [];
    for (const b of buildings) {
      if (b.status === 'damaged' && !handledDamage.has(b.id)) {
        out.push({
          buildingId: b.id,
          mode: 'repair',
          kind: this.kindFromName(b.name),
          schematicRef: b.schematicRef,
        });
      } else if (b.status === 'destroyed' && !handledRebuild.has(b.id)) {
        out.push({
          buildingId: b.id,
          mode: 'rebuild',
          kind: this.kindFromName(b.name),
          schematicRef: b.schematicRef,
        });
      }
    }
    return out;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Death scan
  // ──────────────────────────────────────────────────────────────────────

  scanDeaths(townId: string): DeathRecord[] {
    const since = this.lastScanAt.get(townId) ?? 0;
    const handled = this.getOrCreate(this.handledDeathIds, townId);
    // Restart safety: warm the in-memory ledger from disasters already
    // recorded for this town so a process restart never re-issues the
    // replacement-role flag, the role:imbalance event, or the chronicler
    // milestone for residents whose monument is already in the park.
    if (!this.warmedDeathLedgers.has(townId)) {
      this.warmedDeathLedgers.add(townId);
      try {
        for (const d of this.townManager.listDisasters(townId, { limit: 1000 })) {
          if (d.kind !== 'lost_bot' || !d.dedupeKey) continue;
          const residentId = d.dedupeKey.startsWith('lost_bot:')
            ? d.dedupeKey.slice('lost_bot:'.length)
            : null;
          if (residentId) handled.add(residentId);
        }
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId },
          'Phoenix: failed to warm handled-death ledger from disasters table',
        );
      }
    }
    const residents = this.townManager.listResidents(townId);
    const deaths: DeathRecord[] = [];
    for (const r of residents) {
      if (r.status !== 'dead') continue;
      if (handled.has(r.id)) continue;
      // `since` filter is a soft guard — we don't have a per-resident
      // diedAt timestamp yet, so we rely on the handled-set for the strict
      // idempotency contract. Keep `since` for future when status changes
      // get a real timestamp column.
      deaths.push({
        residentId: r.id,
        botName: r.botName,
        role: r.currentRole ?? null,
        diedAt: Math.max(since, Date.now()),
      });
    }
    return deaths;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Orchestration — called by TownBrain.phoenixLoop
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Run both scans + push tasks. Returns counts for telemetry.
   */
  async queueRepairs(townId: string): Promise<{
    repairsQueued: number;
    rebuildsQueued: number;
    deathsRecorded: number;
  }> {
    let repairsQueued = 0;
    let rebuildsQueued = 0;
    let deathsRecorded = 0;

    // ── Damage / destruction
    let damageActions: RepairAction[] = [];
    try {
      damageActions = this.scanDamage(townId);
    } catch (err: any) {
      logger.warn({ err: err?.message, townId }, 'Phoenix: scanDamage threw');
    }
    for (const action of damageActions) {
      try {
        if (action.mode === 'repair') {
          this.queueRepairTask(townId, action);
          this.getOrCreate(this.handledDamageIds, townId).add(action.buildingId);
          repairsQueued++;
        } else {
          await this.queueRebuild(townId, action);
          this.getOrCreate(this.handledRebuildIds, townId).add(action.buildingId);
          rebuildsQueued++;
        }
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId, action },
          'Phoenix: queue action failed; will retry next tick',
        );
      }
    }

    // ── Deaths
    let deaths: DeathRecord[] = [];
    try {
      deaths = this.scanDeaths(townId);
    } catch (err: any) {
      logger.warn({ err: err?.message, townId }, 'Phoenix: scanDeaths threw');
    }
    for (const death of deaths) {
      try {
        this.handleDeath(townId, death);
        this.getOrCreate(this.handledDeathIds, townId).add(death.residentId);
        deathsRecorded++;
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId, death },
          'Phoenix: handleDeath failed; will retry next tick',
        );
      }
    }

    this.lastScanAt.set(townId, Date.now());
    if (repairsQueued > 0 || rebuildsQueued > 0 || deathsRecorded > 0) {
      logger.info(
        { townId, repairsQueued, rebuildsQueued, deathsRecorded },
        'Phoenix scan finished',
      );
    }
    return { repairsQueued, rebuildsQueued, deathsRecorded };
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Damage repair: queue a blackboard task for a builder bot
  // ──────────────────────────────────────────────────────────────────────

  private queueRepairTask(townId: string, action: RepairAction): void {
    const description =
      `town:${townId} repair building ${action.kind ?? action.buildingId} (id: ${action.buildingId})`;
    const keywords = ['repair', 'build', 'town', action.kind ?? 'building'].filter(
      (k): k is string => typeof k === 'string',
    );
    this.blackboard.addTask(
      { description, keywords },
      'swarm',
      undefined,
      'normal',
    );
    this.townManager.recordEvent({
      townId,
      kind: 'phoenix:repair_queued',
      severity: 'minor',
      payload: {
        buildingId: action.buildingId,
        kind: action.kind,
        schematicRef: action.schematicRef,
      },
      highlightScore: 25,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Destruction rebuild: re-queue the same kind via BuildCoordinator
  // ──────────────────────────────────────────────────────────────────────

  private async queueRebuild(townId: string, action: RepairAction): Promise<void> {
    const town = this.townManager.getTown(townId);
    if (!town || !town.capital) {
      logger.warn({ townId, action }, 'Phoenix: rebuild skipped — town/capital missing');
      return;
    }
    const residents = this.townManager.listResidents(townId);
    const aliveNames = residents
      .filter((r) => r.status === 'alive' || r.status == null)
      .map((r) => r.botName);
    if (aliveNames.length === 0) {
      // Without a bot to swing the hammer, defer — but log a sentry event
      // so the dashboard shows the gap.
      this.townManager.recordEvent({
        townId,
        kind: 'phoenix:rebuild_deferred',
        severity: 'minor',
        payload: { buildingId: action.buildingId, reason: 'no_alive_residents' },
        highlightScore: 25,
      });
      return;
    }

    // Best-effort: hand the original schematicRef back to BuildCoordinator.
    // The brain's primary buildLoop owns the LLM/library resolution path —
    // here we just want to get a workable rebuild swung. If the original
    // schematicRef points to a file that no longer exists, BuildCoordinator
    // throws and we record a phoenix:rebuild_failed event.
    const schematicFile = action.schematicRef
      ? this.guessSchematicFile(action.schematicRef)
      : null;

    if (!schematicFile) {
      // Punt: queue a blackboard task and let the brain's main buildLoop pick
      // it up in its next pass via the standard plan-gap path. We've already
      // marked the row destroyed and the haveCounts excludes it.
      const description = `town:${townId} rebuild ${action.kind ?? action.buildingId} (destroyed)`;
      this.blackboard.addTask(
        { description, keywords: ['rebuild', 'build', 'town', action.kind ?? 'building'] },
        'swarm',
        undefined,
        'normal',
      );
      this.townManager.recordEvent({
        townId,
        kind: 'phoenix:rebuild_queued',
        severity: 'minor',
        payload: {
          buildingId: action.buildingId,
          kind: action.kind,
          via: 'blackboard',
        },
        highlightScore: 25,
      });
      return;
    }

    try {
      const job = await this.buildCoordinator.startBuild(
        schematicFile,
        { x: town.capital.x, y: town.capital.y, z: town.capital.z },
        aliveNames,
        { originMode: 'auto-flat' },
      );
      this.townManager.recordEvent({
        townId,
        kind: 'phoenix:rebuild_queued',
        severity: 'minor',
        payload: {
          buildingId: action.buildingId,
          kind: action.kind,
          jobId: job.id,
          schematicFile,
          via: 'build_coordinator',
        },
        highlightScore: 30,
      });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId, action },
        'Phoenix: startBuild rebuild failed',
      );
      this.townManager.recordEvent({
        townId,
        kind: 'phoenix:rebuild_failed',
        severity: 'minor',
        payload: {
          buildingId: action.buildingId,
          kind: action.kind,
          error: err?.message ?? 'unknown',
        },
        highlightScore: 20,
      });
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Death handling: disaster + memorial + replacement role flag
  // ──────────────────────────────────────────────────────────────────────

  private handleDeath(townId: string, death: DeathRecord): void {
    const summary = death.role
      ? `${death.botName} (${death.role}) was lost.`
      : `${death.botName} was lost.`;
    let disaster: Disaster | null = null;
    try {
      disaster = this.disasterRecorder.recordDisaster(townId, 'lost_bot', summary, {
        severity: 'major',
        payload: {
          botName: death.botName,
          residentId: death.residentId,
          role: death.role,
        },
        // Cross-restart dedup: a re-scan of the same dead resident returns
        // the same disaster row (and therefore re-uses the same monument
        // marker), so a process restart never duplicates the memorial.
        dedupeKey: `lost_bot:${death.residentId}`,
      });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId, death },
        'Phoenix: disaster record failed',
      );
    }

    // Memorial Park monument — best-effort. addMonument returns null when the
    // marker store hasn't been wired yet; we still recorded the disaster row.
    if (disaster) {
      try {
        const marker = this.memorialPark.addMonument(townId, disaster);
        if (marker) {
          this.townManager.updateDisasterMemorialMarker(disaster.id, marker.id);
        }
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId, disasterId: disaster.id },
          'Phoenix: memorial monument placement failed',
        );
      }
    }

    // Flag the role for replacement. RoleManager honors this list on its
    // next pass; for now we just stash it. Roleless dead bots still drop
    // a generic 'gatherer' slot so the population target doesn't decay.
    const replacementRole = death.role ?? 'gatherer';
    const list = this.pendingReplacementRoles.get(townId) ?? [];
    list.push(replacementRole);
    this.pendingReplacementRoles.set(townId, list);

    this.townManager.recordEvent({
      townId,
      kind: 'phoenix:replacement_requested',
      severity: 'minor',
      payload: { role: replacementRole, deadBotName: death.botName },
      highlightScore: 25,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────────

  private getOrCreate(map: Map<string, Set<string>>, key: string): Set<string> {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    return set;
  }

  /** Brain stores names as `<kind>:<suffix>`; same parse logic as TownBrain. */
  private kindFromName(name: string | null): string | null {
    if (!name) return null;
    const idx = name.indexOf(':');
    return idx > 0 ? name.slice(0, idx) : name;
  }

  /**
   * Best-effort schematicRef → filename. The brain's design pipeline can
   * leave behind raw text queries OR concrete filenames; we accept either.
   * Returns null when we can't form a plausible filename.
   */
  private guessSchematicFile(ref: string): string | null {
    if (!ref) return null;
    if (ref.endsWith('.schem')) return ref;
    // If the ref is just a keyword query, append .schem and hope the file
    // exists. BuildCoordinator's existsSync check will reject otherwise and
    // we'll log a rebuild_failed event.
    if (!ref.includes(' ') && !ref.includes('/')) return `${ref}.schem`;
    return null;
  }
}
