/**
 * TownManager — top-level service for the Autonomous Town Builder.
 *
 * Owns the SQLite connection (opened via `openTownDb`) and all the CRUD logic
 * the API layer needs in Phase 1: town founding, listing, residents, events,
 * districts, etc. Wraps every write in try/catch and delegates to the JSONL
 * fallback (`appendFallback`) on failure so the dashboard never silently
 * drops data while the DB is wedged.
 */
import crypto from 'crypto';
import path from 'path';
import { and, desc, eq, gt } from 'drizzle-orm';
import {
  Building,
  CreateResidentInput,
  CreateTownInput,
  Disaster,
  District,
  Resident,
  Town,
  TownConfig,
  TownEvent,
  Vec3,
  defaultDistrictBounds,
} from './Town';
import type { Approval, ApprovalKind, ApprovalStatus, ApprovalVotes } from './Approval';
import type { Relationship, RelationshipEvent, RelationshipState } from './Relationship';
import { DiplomacyManager } from './DiplomacyManager';
import { clampTrust, DEFAULT_TRUST } from './diplomacy';
import { openTownDb, TownDb, TownDbHandle } from './db';
import * as schema from './schema';
import { ApprovalRepository } from './ApprovalRepository';
import { RelationshipRepository } from './RelationshipRepository';
import { StyleObservationRepository } from './StyleObservationRepository';
import { ChronicleRepository } from './ChronicleRepository';
import { DisasterRepository } from './DisasterRepository';
import { DistrictRepository } from './DistrictRepository';
import { BuildingRepository } from './BuildingRepository';
import { genId, safeJsonParse } from './rows';
import {
  appendFallback,
  clearFallbackFile,
  FallbackEntry,
  FallbackKind,
  readAllFallback,
} from './fallback';
import { buildSeedStyle } from './seedStyle';
import { writeStyle, type StyleSeed } from './StyleDoc';
import { logger } from '../util/logger';
import { TownBrain, TownBrainStatus } from './TownBrain';
import { MayorService } from './MayorService';
import type { BotManager } from '../bot/BotManager';
import type { BuildCoordinator } from '../build/BuildCoordinator';
import type { BlackboardManager } from '../voyager/BlackboardManager';
import type { SchematicMatcher } from '../build/SchematicMatcher';

type TownRow = typeof schema.towns.$inferSelect;
type DistrictRow = typeof schema.districts.$inferSelect;
type ResidentRow = typeof schema.residents.$inferSelect;
type BuildingRow = typeof schema.buildings.$inferSelect;
type EventRow = typeof schema.events.$inferSelect;
type ChronicleRow = typeof schema.chronicleEntries.$inferSelect;
type JournalRow = typeof schema.botJournals.$inferSelect;
type ApprovalRow = typeof schema.approvals.$inferSelect;
type RelationshipRow = typeof schema.relationships.$inferSelect;

// genId / safeJsonParse / rowToApproval now live in ./rows (shared by repos).


function rowToTown(row: TownRow): Town {
  const capital: Vec3 | null =
    row.capitalX != null && row.capitalY != null && row.capitalZ != null
      ? { x: row.capitalX, y: row.capitalY, z: row.capitalZ }
      : null;
  return {
    id: row.id,
    name: row.name,
    foundedAt: row.foundedAt,
    capital,
    tier: (row.tier as Town['tier']) ?? 'founding',
    status: (row.status as Town['status']) ?? 'active',
    populationTarget: row.populationTarget ?? null,
    allianceState: (row.allianceState as Town['allianceState']) ?? null,
    parentTownId: row.parentTownId ?? null,
    styleSeed: row.styleSeed ?? null,
    config: safeJsonParse<TownConfig>(row.configJson ?? null, {}),
  };
}

/**
 * Project a Town + its residents into the DTO shape the dashboard expects.
 * The DTO flattens internal-only fields (config.mayor.*), renames
 * `allianceState` -> `alliance`, and adds a computed `population` count
 * derived from the residents table (alive or status-null residents only).
 *
 * This is the public-facing contract. Internal callers stick with `Town`.
 */
export interface TownDTO {
  id: string;
  name: string;
  foundedAt: number;
  capital: { x: number; y: number; z: number };
  tier: 'founding' | 'village' | 'town';
  status: 'active' | 'dormant' | 'abandoned';
  population: number;
  populationTarget: number | null;
  alliance: 'allied' | 'rival' | 'neutral' | null;
  parentTownId: string | null;
  styleSeed: 'medieval-communal' | 'mid-century-civic' | null;
  mayorTitle: string | null;
  mayorPlayerName: string | null;
  /** Town Brain paused flag — sourced from the in-memory brain, not the DB. */
  paused: boolean;
}

export function townToDTO(
  town: Town,
  residents: Resident[],
  paused: boolean = false,
): TownDTO {
  const alivePop = residents.filter(
    (r) => r.status === 'alive' || r.status == null,
  ).length;
  // Capital must exist for a valid town; createTown rejects payloads without
  // it, so this fallback is only for legacy rows. Use the capital coords or
  // a safe default (0/64/0) so the DTO is never null.
  const capital = town.capital ?? { x: 0, y: 64, z: 0 };
  return {
    id: town.id,
    name: town.name,
    foundedAt: town.foundedAt,
    capital,
    tier: town.tier,
    status: town.status,
    population: alivePop,
    populationTarget: town.populationTarget,
    alliance: town.allianceState,
    parentTownId: town.parentTownId,
    styleSeed: town.styleSeed as TownDTO['styleSeed'],
    mayorTitle: (town.config?.mayor?.title as string | undefined) ?? null,
    mayorPlayerName: (town.config?.mayor?.playerName as string | undefined) ?? null,
    paused,
  };
}

// rowToDistrict now lives in ./DistrictRepository.

function rowToResident(row: ResidentRow): Resident {
  return {
    id: row.id,
    townId: row.townId ?? '',
    botName: row.botName,
    joinedAt: row.joinedAt,
    currentRole: row.currentRole ?? null,
    status: row.status ?? null,
  };
}

// rowToBuilding now lives in ./BuildingRepository.

function rowToEvent(row: EventRow): TownEvent {
  return {
    id: row.id,
    townId: row.townId ?? '',
    kind: row.kind,
    severity: row.severity ?? null,
    payload: safeJsonParse<unknown>(row.payloadJson ?? null, null),
    occurredAt: row.occurredAt,
    highlightScore: row.highlightScore ?? null,
  };
}

export interface TownEventInput {
  townId: string;
  kind: string;
  severity?: TownEvent['severity'];
  payload?: unknown;
  occurredAt?: number;
  highlightScore?: number;
}

/**
 * A chronicle row — the narrative summary the Chronicle Generator (Phase 4-B)
 * writes once per Minecraft day plus on milestones. Daily entries are
 * idempotent by (townId, dayNumber, 'daily').
 */
export interface ChronicleEntry {
  id: string;
  townId: string;
  dayNumber: number;
  kind: 'daily' | 'milestone' | 'disaster' | 'voice' | string;
  body: string;
  generatedAt: number | null;
  model: string | null;
}

export interface ChronicleEntryInput {
  townId: string;
  dayNumber: number;
  kind: ChronicleEntry['kind'];
  body: string;
  model?: string | null;
  generatedAt?: number;
}

/** Per-resident first-person journal row (Phase 4-B scaffolding). */
export interface BotJournalEntry {
  id: string;
  townId: string;
  botName: string;
  dayNumber: number | null;
  body: string;
  generatedAt: number | null;
}

export interface BotJournalInput {
  townId: string;
  botName: string;
  dayNumber?: number | null;
  body: string;
  generatedAt?: number;
}

// rowToChronicle / rowToJournal now live in ./ChronicleRepository.
// rowToRelationship now lives in ./rows (used by RelationshipRepository).

export interface TownManagerOptions {
  /** Override the data directory (defaults to `<cwd>/data`). Useful for tests. */
  dataDir?: string;
  /** Inject a pre-opened handle (tests). When unset, a new connection is opened. */
  handle?: TownDbHandle;
}

export class TownManager {
  private readonly dataDir: string;
  private readonly handle: TownDbHandle;
  private readonly db: TownDb;
  /** Approvals persistence (extracted repository; TownManager delegates). */
  private readonly approvals: ApprovalRepository;
  /** Relationship-edge persistence (extracted repository; TownManager delegates). */
  private readonly relationships: RelationshipRepository;
  /** Style-observation persistence (extracted repository; TownManager delegates). */
  private readonly styleObservations: StyleObservationRepository;
  /** Chronicle + bot-journal persistence (extracted repository; TownManager delegates). */
  private readonly chronicles: ChronicleRepository;
  /** Disaster persistence (extracted repository; TownManager delegates). */
  private readonly disasters: DisasterRepository;
  /** District persistence (extracted repository; TownManager delegates). */
  private readonly districts: DistrictRepository;
  /** Building persistence (extracted repository; TownManager delegates). */
  private readonly buildings: BuildingRepository;
  /**
   * Per-town Town Brain instances. Created lazily by `wireBrains()` once the
   * BotManager / BuildCoordinator / BlackboardManager dependencies are
   * available (TownManager is constructed inside BotManager, but the build
   * coordinator only exists in the API layer — so wiring happens after both).
   */
  private readonly townBrains: Map<string, TownBrain> = new Map();
  private brainDeps: {
    botManager: BotManager;
    buildCoordinator: BuildCoordinator;
    blackboard: BlackboardManager;
    /** Phase 4 — optional library-fallback matcher for the LLM design pipeline. */
    schematicMatcher?: SchematicMatcher;
  } | null = null;
  /**
   * Phase 5-A — post-hoc deps for the Phoenix loop. Set by wirePhoenixDeps()
   * once api.ts has built the ChronicleGenerator + MarkerStore. Late-created
   * brains (createTown after wirePhoenixDeps) read these to wire themselves.
   */
  private phoenixDeps: {
    chronicleGenerator: import('./ChronicleGenerator').ChronicleGenerator | null;
    markerStore: import('../control/MarkerStore').MarkerStore | null;
  } | null = null;
  /**
   * Phase 6-A — singleton MayorService. Lazily constructed (after the
   * TownManager itself, so the ctor can pass `this`). Exposed via
   * `getMayorService()` so the API layer and the TownBrain can share one
   * instance — cooldown state lives on this service, not on each brain.
   */
  private mayorService: MayorService | null = null;
  /**
   * Phase 7-A — singleton DiplomacyManager. Same lazy-construction pattern
   * as MayorService so the per-process sustain-counter map lives in exactly
   * one place. Shared by every TownBrain's diplomacyLoop + the api.ts
   * relationship routes.
   */
  private diplomacyManager: DiplomacyManager | null = null;

  /**
   * Phase 8 — optional event emitter callback. The API layer injects this
   * via setEventEmitter() so every successful recordEvent() insert also
   * fans out over Socket.IO + the in-process HighlightStream. Keeping it as
   * a callback (rather than importing socket.io / HighlightStream here)
   * preserves the existing layering: TownManager owns persistence, the API
   * layer owns transport.
   */
  private eventEmitter: ((event: TownEvent) => void) | null = null;

  constructor(opts: TownManagerOptions = {}) {
    this.dataDir = opts.dataDir ?? path.join(process.cwd(), 'data');
    this.handle = opts.handle ?? openTownDb(this.dataDir);
    this.db = this.handle.db;
    const fallbackAppend = (table: string, townId: string, row: unknown) =>
      this.appendFallbackRow(table as FallbackKind, townId, row as Record<string, unknown>);
    this.approvals = new ApprovalRepository(this.db, fallbackAppend);
    this.relationships = new RelationshipRepository(this.db, fallbackAppend);
    this.styleObservations = new StyleObservationRepository(this.db, fallbackAppend);
    this.chronicles = new ChronicleRepository(this.db, fallbackAppend, (id) => this.getTown(id));
    this.disasters = new DisasterRepository(this.db, fallbackAppend, (id) => this.listResidents(id));
    this.districts = new DistrictRepository(this.db, (id) => this.getTown(id));
    this.buildings = new BuildingRepository(this.db, this.handle.sqlite);
    // Drain any pending JSONL fallback into the DB at boot. Best-effort —
    // failures here are logged but never abort startup.
    this.drainFallback();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Lifecycle
  // ──────────────────────────────────────────────────────────────────────

  shutdown(): void {
    // Stop every brain before closing the DB so no late tick tries to
    // touch a closed connection.
    for (const brain of this.townBrains.values()) {
      try { brain.stop(); } catch { /* swallow */ }
    }
    this.townBrains.clear();
    try {
      this.handle.sqlite.close();
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'TownManager shutdown: close failed');
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Town Brain (Phase 2) — periodic tick + 4 sub-loops per active town
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Inject the dependencies the Town Brain needs and boot a brain for every
   * currently-active town.
   *
   * Followup #39 — on a re-wire we MUST stop every existing brain and
   * recreate it with the new deps. The previous implementation only updated
   * `brainDeps` and left running brains holding stale dep references by
   * closure, so a second `wireBrains` quietly diverged the dep set between
   * old and new brains (e.g. some held the original BuildCoordinator while
   * fresh brains held the replacement). Stop+restart is the cleanest fix:
   * the brain ctor is cheap, and the persisted budget ledger + DB-backed
   * resident/building state survive the rebuild. Per-tick in-memory state
   * (lastEmittedPhase, cooldowns, observedCacheHashes) intentionally resets
   * — a re-wire is rare and a conservative state reset matches the brain
   * restart behavior on a hard failure.
   *
   * Called from the API layer at startup after the BuildCoordinator exists,
   * and at config-reload time when any dep is swapped.
   */
  wireBrains(deps: {
    botManager: BotManager;
    buildCoordinator: BuildCoordinator;
    blackboard: BlackboardManager;
    /** Phase 4 — used as the library fallback when LLM design fails. */
    schematicMatcher?: SchematicMatcher;
  }): void {
    // Stop+drop every existing brain so the next startBrain pass rebuilds
    // them against the new deps. Failures during stop are logged but never
    // abort the re-wire — the worst case is a leaked timer that the GC will
    // catch when the brain object is dropped from townBrains below.
    const replacedBrains = this.townBrains.size;
    for (const [townId, brain] of this.townBrains.entries()) {
      try {
        brain.stop();
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId },
          'wireBrains: brain.stop() threw during re-wire (continuing)',
        );
      }
    }
    this.townBrains.clear();

    this.brainDeps = deps;
    let booted = 0;
    for (const town of this.listTowns()) {
      if (town.status !== 'active') continue;
      try {
        this.startBrain(town.id);
        booted++;
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId: town.id },
          'wireBrains: failed to start brain for town',
        );
      }
    }
    logger.info(
      { booted, replacedBrains, totalTowns: this.listTowns().length },
      'TownManager wired brains',
    );
  }

  /**
   * Internal — instantiate and start a brain for the given town. Caller must
   * ensure `brainDeps` is set and the town exists in the DB.
   */
  private startBrain(townId: string): TownBrain | null {
    if (!this.brainDeps) {
      // Phase 2 may be running in test contexts where the brain isn't wired;
      // silently no-op so legacy callers keep working.
      return null;
    }
    if (this.townBrains.has(townId)) return this.townBrains.get(townId) ?? null;
    const brain = new TownBrain(
      townId,
      this,
      this.brainDeps.botManager,
      this.brainDeps.buildCoordinator,
      this.brainDeps.blackboard,
      { schematicMatcher: this.brainDeps.schematicMatcher },
    );
    // Phase 5-A — back-fill the Phoenix deps if api.ts has already wired
    // them. Towns founded BEFORE wirePhoenixDeps run get caught by that
    // method's per-brain loop instead.
    if (this.phoenixDeps) {
      try {
        const phoenix = brain.getPhoenixManager?.();
        if (phoenix) {
          phoenix.setChronicleGenerator(this.phoenixDeps.chronicleGenerator);
          phoenix.setMarkerStore(this.phoenixDeps.markerStore);
        }
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId },
          'startBrain: failed to inject Phoenix deps (continuing)',
        );
      }
    }
    this.townBrains.set(townId, brain);
    // If the operator paused this town in a previous process, the flag was
    // persisted to the towns table — apply it BEFORE starting so the first
    // tick is already paused and no planning runs in the gap.
    if (this.getPersistedPaused(townId)) {
      brain.pause();
      logger.info({ townId }, 'startBrain: applied persisted paused flag');
    }
    brain.start();
    return brain;
  }

  /** Read the persisted paused flag for a town. Returns false for unknown towns. */
  private getPersistedPaused(townId: string): boolean {
    const row = this.db
      .select({ paused: schema.towns.paused })
      .from(schema.towns)
      .where(eq(schema.towns.id, townId))
      .get();
    return row?.paused === true;
  }

  /** Pause the brain for a town. Returns false when the town is unknown. */
  pauseTown(townId: string): boolean {
    if (!this.getTown(townId)) return false;
    // Persist BEFORE touching the in-memory brain so a crash between the two
    // doesn't leave the brain paused with a stale paused=false in the DB.
    this.db
      .update(schema.towns)
      .set({ paused: true })
      .where(eq(schema.towns.id, townId))
      .run();
    const brain = this.townBrains.get(townId);
    if (brain) brain.pause();
    return true;
  }

  /** Resume a paused brain. Returns false when the town is unknown. */
  resumeTown(townId: string): boolean {
    if (!this.getTown(townId)) return false;
    this.db
      .update(schema.towns)
      .set({ paused: false })
      .where(eq(schema.towns.id, townId))
      .run();
    const brain = this.townBrains.get(townId);
    if (brain) brain.resume();
    return true;
  }

  /**
   * Phase 5-A — inject post-hoc deps the Phoenix loop needs but that don't
   * exist until later in the API bootstrap (ChronicleGenerator is built after
   * wireBrains, MarkerStore even later). Idempotent: calling again replaces
   * the previous refs on every brain. Safe before any brain exists (no-op).
   */
  wirePhoenixDeps(deps: {
    chronicleGenerator?: import('./ChronicleGenerator').ChronicleGenerator | null;
    markerStore?: import('../control/MarkerStore').MarkerStore | null;
  }): void {
    for (const brain of this.townBrains.values()) {
      try {
        const phoenix = brain.getPhoenixManager?.();
        if (!phoenix) continue;
        if (deps.chronicleGenerator !== undefined) {
          phoenix.setChronicleGenerator(deps.chronicleGenerator);
        }
        if (deps.markerStore !== undefined) {
          phoenix.setMarkerStore(deps.markerStore);
        }
      } catch (err: any) {
        logger.warn(
          { err: err?.message },
          'wirePhoenixDeps: failed to wire deps on a brain (continuing)',
        );
      }
    }
    // Stash on this so future-created brains pick up the same refs. createTown
    // calls startBrain after wirePhoenixDeps so we propagate there too.
    this.phoenixDeps = {
      chronicleGenerator: deps.chronicleGenerator ?? this.phoenixDeps?.chronicleGenerator ?? null,
      markerStore: deps.markerStore ?? this.phoenixDeps?.markerStore ?? null,
    };
  }

  /**
   * Snapshot of a town's brain status — null when the brain hasn't been
   * wired/started yet (e.g. brainDeps unset, or town is abandoned).
   */
  getBrainStatus(townId: string): TownBrainStatus | null {
    const brain = this.townBrains.get(townId);
    if (!brain) return null;
    return brain.getStatus();
  }

  /**
   * Direct accessor for the town's Phase 3 role/schedule helpers. Returns
   * null when the brain isn't wired (e.g. tests). The API layer uses this
   * to surface manual overrides + schedule previews without poking the
   * brain's tick loop.
   */
  getTownBrain(townId: string): TownBrain | null {
    return this.townBrains.get(townId) ?? null;
  }

  /** True iff the brain for the town exists AND is paused. */
  isTownPaused(townId: string): boolean {
    return this.townBrains.get(townId)?.isPaused() ?? false;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Mayor (Phase 6-A) — shared service for player greetings + decree auth
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Lazy singleton accessor for the per-process MayorService. Shared by the
   * TownBrain's greeting loop and the API layer's mayor-auth helpers so
   * cooldown state lives in exactly one place.
   */
  getMayorService(): MayorService {
    if (!this.mayorService) this.mayorService = new MayorService(this);
    return this.mayorService;
  }

  /**
   * Phase 7-A — lazy singleton accessor for the per-process
   * DiplomacyManager. Every TownBrain.diplomacyLoop reaches for this so the
   * sustain-counter map (auto-transition hysteresis) is shared across towns.
   * The api.ts relationship routes use the same instance.
   */
  getDiplomacyManager(): DiplomacyManager {
    if (!this.diplomacyManager) this.diplomacyManager = new DiplomacyManager(this);
    return this.diplomacyManager;
  }

  /**
   * Update the mayor on a town's config in-place. Used by MayorService.setMayor
   * (which Phase 6-B's voting flow ultimately calls). Returns false when the
   * town is unknown or the write fails. Existing config.mayor.* fields
   * (stealth, voteWeight) are preserved.
   */
  setMayor(townId: string, playerName: string, title: string): boolean {
    const town = this.getTown(townId);
    if (!town) return false;
    const mayor = {
      ...(town.config?.mayor ?? {}),
      playerName,
      title,
    };
    const updated = this.updateTown(townId, { config: { ...town.config, mayor } });
    return updated != null;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Towns
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Found a new town. Also auto-creates the founding district ("Old Town",
   * 64x64 around the capital, marked as default) and seeds a `town_founded`
   * event.
   */
  createTown(input: CreateTownInput): { town: Town; district: District } {
    const id = genId('town');
    const now = Date.now();
    const config: TownConfig = {
      mayor: {
        title: input.mayorTitle ?? 'Mayor Lord Savior',
        playerName: input.mayorPlayerName,
        stealth: false,
        voteWeight: 1.0,
      },
      sliders: {},
    };

    try {
      this.db
        .insert(schema.towns)
        .values({
          id,
          name: input.name,
          foundedAt: now,
          capitalX: input.capital.x,
          capitalY: input.capital.y,
          capitalZ: input.capital.z,
          tier: 'founding',
          status: 'active',
          populationTarget: null,
          allianceState: null,
          parentTownId: input.parentTownId ?? null,
          styleSeed: input.stylePreset,
          configJson: JSON.stringify(config),
        })
        .run();
    } catch (err: any) {
      // A failed town insert is fatal for this call — no row, no district —
      // so rethrow after logging. The fallback layer is for downstream events
      // and chronicle rows, not the towns table itself.
      logger.error({ err: err?.message, id }, 'Failed to insert town');
      throw err;
    }

    const district = this.districts.createDefaultDistrict(id, input.capital, input.stylePreset, now);

    // Drop the founding style.json seed (medieval or mid-century) at
    // data/towns/<id>/style.json. Wrapped here AND inside writeStyle —
    // a failed style write must never abort town creation.
    try {
      const seed = buildSeedStyle(input.stylePreset as StyleSeed, id, now);
      writeStyle(this.dataDir, seed);
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId: id, stylePreset: input.stylePreset },
        'createTown: style seed write failed (non-fatal)',
      );
    }

    // Seed the founding event. If it fails to persist, the JSONL fallback
    // catches it.
    this.recordEvent({
      townId: id,
      kind: 'town_founded',
      severity: 'major',
      payload: {
        name: input.name,
        stylePreset: input.stylePreset,
        capital: input.capital,
      },
      occurredAt: now,
      highlightScore: 100,
    });

    // Followup #49 — fire the `town_founded` chronicle milestone too so the
    // chronicler writes a founding narrative entry. Best-effort: a wedged
    // chronicler (rate-limited LLM, unwired generator) must not abort
    // createTown. recordMilestone wraps both halves in their own try/catch.
    this.recordMilestone(id, 'town_founded', {
      name: input.name,
      stylePreset: input.stylePreset,
    });

    const townRow = this.db.select().from(schema.towns).where(eq(schema.towns.id, id)).get();
    const town = townRow ? rowToTown(townRow) : rowToTown({
      id,
      name: input.name,
      foundedAt: now,
      capitalX: input.capital.x,
      capitalY: input.capital.y,
      capitalZ: input.capital.z,
      tier: 'founding',
      status: 'active',
      populationTarget: null,
      allianceState: null,
      parentTownId: input.parentTownId ?? null,
      styleSeed: input.stylePreset,
      configJson: JSON.stringify(config),
    } as TownRow);

    logger.info({ townId: id, name: input.name, stylePreset: input.stylePreset }, 'Town founded');

    // Auto-boot a brain when deps have been wired. When TownManager is
    // constructed before the API layer wires brains (the normal startup
    // path), wireBrains() picks the new town up on its own.
    try { this.startBrain(id); } catch (err: any) {
      logger.warn({ err: err?.message, townId: id }, 'createTown: startBrain failed (non-fatal)');
    }

    return { town, district };
  }

  listTowns(): Town[] {
    const rows = this.db.select().from(schema.towns).all();
    return rows.map(rowToTown);
  }

  getTown(id: string): Town | null {
    const row = this.db.select().from(schema.towns).where(eq(schema.towns.id, id)).get();
    return row ? rowToTown(row) : null;
  }

  /**
   * Apply a partial update. Only fields explicitly present in `patch` are
   * touched. `capital` and `config` are JSON-encoded; everything else is a
   * scalar passthrough.
   */
  updateTown(id: string, patch: Partial<Town>): Town | null {
    const current = this.getTown(id);
    if (!current) return null;

    const fields: Partial<TownRow> = {};
    if (patch.name !== undefined) fields.name = patch.name;
    if (patch.tier !== undefined) fields.tier = patch.tier;
    if (patch.status !== undefined) fields.status = patch.status;
    if (patch.populationTarget !== undefined) fields.populationTarget = patch.populationTarget;
    if (patch.allianceState !== undefined) fields.allianceState = patch.allianceState ?? null;
    if (patch.parentTownId !== undefined) fields.parentTownId = patch.parentTownId ?? null;
    if (patch.styleSeed !== undefined) fields.styleSeed = patch.styleSeed ?? null;
    if (patch.capital !== undefined) {
      if (patch.capital == null) {
        fields.capitalX = null;
        fields.capitalY = null;
        fields.capitalZ = null;
      } else {
        fields.capitalX = patch.capital.x;
        fields.capitalY = patch.capital.y;
        fields.capitalZ = patch.capital.z;
      }
    }
    if (patch.config !== undefined) {
      const merged: TownConfig = { ...current.config, ...(patch.config ?? {}) };
      fields.configJson = JSON.stringify(merged);
    }

    if (Object.keys(fields).length === 0) return current;
    this.db.update(schema.towns).set(fields).where(eq(schema.towns.id, id)).run();
    return this.getTown(id);
  }

  /** Soft-delete: transitions the town to 'abandoned', preserving all data. */
  abandonTown(id: string): boolean {
    const current = this.getTown(id);
    if (!current) return false;
    this.db
      .update(schema.towns)
      .set({ status: 'abandoned' })
      .where(eq(schema.towns.id, id))
      .run();
    // Stop the brain immediately so no further ticks fire for the
    // abandoned town. The brain entry itself is removed so a later
    // `wireBrains()` pass doesn't re-boot it (status filter excludes it).
    const brain = this.townBrains.get(id);
    if (brain) {
      try { brain.stop(); } catch { /* swallow */ }
      this.townBrains.delete(id);
    }
    // Phase 6-A — drop greeting cooldowns so a future re-founding doesn't
    // inherit stale (bot, player) entries.
    try { this.mayorService?.clearTown(id); } catch { /* swallow */ }
    this.recordEvent({
      townId: id,
      kind: 'town_abandoned',
      severity: 'major',
      payload: { name: current.name },
      highlightScore: 80,
    });
    logger.info({ townId: id }, 'Town marked abandoned');
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Districts
  // ──────────────────────────────────────────────────────────────────────

  // District persistence is delegated to DistrictRepository.
  listDistricts(townId: string): District[] {
    return this.districts.listDistricts(townId);
  }

  createDistrict(input: {
    townId: string;
    name: string;
    stylePreset: string;
    center: Vec3;
    isDefault?: boolean;
  }): District | null {
    return this.districts.createDistrict(input);
  }

  /**
   * Phase 5-B — list every town whose `parentTownId` equals the given
   * townId. Used by ExpansionManager to enforce the "one child per tick"
   * cap and by the dashboard to render the child-towns card.
   */
  getChildTowns(parentTownId: string): Town[] {
    const rows = this.db
      .select()
      .from(schema.towns)
      .where(eq(schema.towns.parentTownId, parentTownId))
      .all();
    return rows.map(rowToTown);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Residents
  // ──────────────────────────────────────────────────────────────────────

  addResident(townId: string, input: CreateResidentInput): Resident | null {
    const town = this.getTown(townId);
    if (!town) return null;
    const id = genId('res');
    const joinedAt = Date.now();
    try {
      this.db
        .insert(schema.residents)
        .values({
          id,
          townId,
          botName: input.botName,
          joinedAt,
          currentRole: input.role ?? null,
          status: 'alive',
        })
        .run();
    } catch (err: any) {
      logger.error({ err: err?.message, townId, botName: input.botName }, 'Failed to insert resident');
      throw err;
    }
    const resident: Resident = {
      id,
      townId,
      botName: input.botName,
      joinedAt,
      currentRole: input.role ?? null,
      status: 'alive',
    };
    this.recordEvent({
      townId,
      kind: 'resident_joined',
      severity: 'info',
      payload: { botName: input.botName, role: input.role ?? null },
      highlightScore: 30,
    });
    return resident;
  }

  listResidents(townId: string): Resident[] {
    const rows = this.db
      .select()
      .from(schema.residents)
      .where(eq(schema.residents.townId, townId))
      .all();
    return rows.map(rowToResident);
  }

  /**
   * Persist a role change. Returns false when the resident doesn't exist for
   * the given town. Failures (DB write) are logged and surfaced as false so
   * the caller can decide whether to retry. RoleManager is the primary
   * consumer; the API layer also calls this for manual overrides.
   *
   * No-ops (role already equals the requested value) return true without a
   * DB write. We deliberately do NOT record a `role:assigned` event here —
   * the caller (TownBrain or the API handler) owns event emission so we
   * don't double-fire when RoleManager applies bulk changes.
   */
  setResidentRole(townId: string, botName: string, role: string): boolean {
    const lookup = this.db
      .select()
      .from(schema.residents)
      .where(
        and(eq(schema.residents.townId, townId), eq(schema.residents.botName, botName)),
      )
      .get();
    if (!lookup) return false;
    if (lookup.currentRole === role) return true;
    try {
      this.db
        .update(schema.residents)
        .set({ currentRole: role })
        .where(eq(schema.residents.id, lookup.id))
        .run();
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId, botName, role },
        'setResidentRole: update failed',
      );
      return false;
    }
    return true;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Buildings
  // ──────────────────────────────────────────────────────────────────────

  // Building persistence is delegated to BuildingRepository.
  listBuildings(townId: string): Building[] {
    return this.buildings.listBuildings(townId);
  }

  createPlannedBuilding(input: {
    townId: string;
    name: string;
    schematicSource?: string | null;
    schematicRef?: string | null;
    districtId?: string | null;
  }): Building {
    return this.buildings.createPlannedBuilding(input);
  }

  setBuildingDistrict(buildingId: string, districtId: string): boolean {
    return this.buildings.setBuildingDistrict(buildingId, districtId);
  }

  updateBuildingStatus(
    buildingId: string,
    status: 'planned' | 'building' | 'complete' | 'damaged' | 'destroyed',
  ): void {
    this.buildings.updateBuildingStatus(buildingId, status);
  }

  recordBuildingPlacement(
    buildingId: string,
    placement: {
      origin: { x: number; y: number; z: number };
      width?: number | null;
      height?: number | null;
      depth?: number | null;
      status?: 'building' | 'complete';
    },
  ): void {
    this.buildings.recordBuildingPlacement(buildingId, placement);
  }

  deleteBuilding(buildingId: string): void {
    this.buildings.deleteBuilding(buildingId);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Events — first-class observability surface
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Phase 8 — inject the event emitter callback. The API layer wires this at
   * startup so every recordEvent() also fans out over Socket.IO + the
   * HighlightStream. Idempotent — calling it twice replaces the previous
   * callback. Pass `null` to detach.
   */
  setEventEmitter(fn: ((event: TownEvent) => void) | null): void {
    this.eventEmitter = fn;
  }

  /**
   * Persist an event. Returns the canonical TownEvent regardless of whether
   * the row landed in SQLite or in the JSONL fallback.
   *
   * Phase 8 — after persistence (or fallback), fans the event out through
   * the optional emitter callback so the API layer can broadcast over
   * Socket.IO and feed the HighlightStream ring. The emitter is best-effort:
   * a thrown callback never blocks the caller or hides the persisted event.
   */
  /**
   * Followup #49 — fire a chronicle milestone hook. Records a structured
   * `chronicle:milestone:<kind>` event (so the dashboard event feed picks
   * it up even without an LLM) and best-effort asks the ChronicleGenerator
   * to write a milestone narrative entry. Both halves are independently
   * wrapped — a wedged generator never aborts the event record, and a
   * failed event record never blocks the generator call.
   *
   * Callers:
   *   - `createTown` fires `town_founded` directly.
   *   - DistrictManager (agent C) calls into this hook from its
   *     `onTierUpgrade` seed flow with `kind='tier_upgrade'`.
   *   - ExpansionManager (agent C) calls into this hook from
   *     `executeProposal` with `kind='expansion'`.
   *
   * The chronicle leg is fire-and-forget: the LLM round-trip happens on a
   * background promise and any rejection is swallowed by the inner catch
   * inside the generator (its generateMilestone already wraps the LLM
   * call). We additionally swallow any synchronous throw from the call
   * itself so the caller never has to await.
   */
  recordMilestone(
    townId: string,
    kind: string,
    payload: Record<string, unknown> = {},
  ): void {
    // Sanity check — silently no-op for unknown towns so callers don't
    // have to pre-validate.
    if (!this.getTown(townId)) {
      logger.debug({ townId, kind }, 'recordMilestone: town not found, skipping');
      return;
    }
    // 1) Event row so the dashboard always sees a milestone marker, even
    //    when the chronicle generator is unwired or rate-limited.
    try {
      this.recordEvent({
        townId,
        kind: `chronicle:milestone:${kind}`,
        severity: 'major',
        payload: { milestone: kind, ...payload },
        highlightScore: 60,
      });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId, kind },
        'recordMilestone: recordEvent leg threw (continuing)',
      );
    }
    // 2) Chronicle narrative — best-effort, fire-and-forget. The generator
    //    itself already wraps the LLM call in a try/catch and falls back
    //    to a placeholder; we just need to guard the call site.
    const gen = this.phoenixDeps?.chronicleGenerator ?? null;
    if (!gen) {
      logger.debug(
        { townId, kind },
        'recordMilestone: chronicleGenerator not wired yet, skipping narrative',
      );
      return;
    }
    try {
      const p = gen.generateMilestone(townId, kind, payload);
      if (p && typeof (p as Promise<unknown>).catch === 'function') {
        (p as Promise<unknown>).catch((err: any) => {
          logger.warn(
            { err: err?.message, townId, kind },
            'recordMilestone: generateMilestone rejected (background)',
          );
        });
      }
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId, kind },
        'recordMilestone: generateMilestone threw synchronously (continuing)',
      );
    }
  }

  recordEvent(input: TownEventInput): TownEvent {
    const id = genId('evt');
    const occurredAt = input.occurredAt ?? Date.now();
    const event: TownEvent = {
      id,
      townId: input.townId,
      kind: input.kind,
      severity: input.severity ?? 'info',
      payload: input.payload ?? null,
      occurredAt,
      highlightScore: input.highlightScore ?? null,
    };
    try {
      this.db
        .insert(schema.events)
        .values({
          id,
          townId: input.townId,
          kind: input.kind,
          severity: event.severity ?? null,
          payloadJson: event.payload == null ? null : JSON.stringify(event.payload),
          occurredAt,
          highlightScore: event.highlightScore,
        })
        .run();
    } catch (err: any) {
      this.appendFallbackRow('events', input.townId, {
        id,
        townId: input.townId,
        kind: input.kind,
        severity: event.severity,
        payload: event.payload,
        occurredAt,
        highlightScore: event.highlightScore,
      });
      logger.warn({ err: err?.message, kind: input.kind, townId: input.townId }, 'Event insert failed; routed to fallback');
    }
    // Fan out to the API-layer hook (Socket.IO + HighlightStream). Swallow
    // any error — broadcast failures must never abort the persisted write.
    if (this.eventEmitter) {
      try {
        this.eventEmitter(event);
      } catch (err: any) {
        logger.warn(
          { err: err?.message, kind: event.kind, townId: event.townId },
          'recordEvent: emitter callback threw',
        );
      }
    }
    return event;
  }

  listEvents(townId: string, opts: { limit?: number; since?: number } = {}): TownEvent[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const whereExpr = opts.since != null
      ? and(eq(schema.events.townId, townId), gt(schema.events.occurredAt, opts.since))
      : eq(schema.events.townId, townId);
    const rows = this.db
      .select()
      .from(schema.events)
      .where(whereExpr)
      .orderBy(desc(schema.events.occurredAt))
      .limit(limit)
      .all();
    return rows.map(rowToEvent);
  }

  /**
   * Phase 8 — per-town highlight feed. Reads from SQLite directly so we get
   * the full event history (not just the in-memory ring) and rides the
   * `idx_events_town_highlight` index (highlight_score DESC, occurred_at
   * DESC). Used by /api/towns/:id/highlights for the streamer.
   */
  listTownHighlights(
    townId: string,
    opts: { limit?: number; since?: number } = {},
  ): TownEvent[] {
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 500);
    const whereExpr = opts.since != null
      ? and(eq(schema.events.townId, townId), gt(schema.events.occurredAt, opts.since))
      : eq(schema.events.townId, townId);
    const rows = this.db
      .select()
      .from(schema.events)
      .where(whereExpr)
      .orderBy(desc(schema.events.highlightScore), desc(schema.events.occurredAt))
      .limit(limit)
      .all();
    return rows.map(rowToEvent);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Chronicle (Phase 4-B) — daily + milestone narrative entries
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Insert a chronicle row. Daily entries should be idempotent by
   * (townId, dayNumber, 'daily') — callers (ChronicleGenerator) check before
   * inserting, but this method itself just writes. Failures fall through to
   * the JSONL fallback layer (kind='chronicle') so a wedged DB never drops
   * the day's narrative.
   */
  // Chronicle + journal persistence is delegated to ChronicleRepository.
  insertChronicleEntry(input: ChronicleEntryInput): ChronicleEntry {
    return this.chronicles.insertChronicleEntry(input);
  }

  listChronicleEntries(
    townId: string,
    opts: { limit?: number; kind?: ChronicleEntry['kind'] } = {},
  ): ChronicleEntry[] {
    return this.chronicles.listChronicleEntries(townId, opts);
  }

  getDailyChronicle(townId: string, dayNumber: number): ChronicleEntry | null {
    return this.chronicles.getDailyChronicle(townId, dayNumber);
  }

  getChronicleDayNumber(townId: string, now: number = Date.now()): number | null {
    return this.chronicles.getChronicleDayNumber(townId, now);
  }

  insertBotJournal(input: BotJournalInput): BotJournalEntry {
    return this.chronicles.insertBotJournal(input);
  }

  listBotJournals(
    townId: string,
    opts: { botName?: string; limit?: number } = {},
  ): BotJournalEntry[] {
    return this.chronicles.listBotJournals(townId, opts);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Build-completion side channel (Phase 1 stub)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Hook invoked by the existing BuildCoordinator's `build:completed` emit
   * (wired once per process in api.ts, so unlike BuildCoordinator's in-memory
   * per-job `onCompleted` hook it SURVIVES a restart and also fires for jobs
   * resumed from disk). When the job carries a `buildingId` (set by TownBrain
   * when it queues a planned building), this is the authoritative place that
   * advances the building row to its terminal state — flip to 'complete' on
   * success, delete on failure/cancel so the kind re-queues cleanly. Without
   * this, a linked build that finishes in a process that didn't start it would
   * leave its row stuck 'building' forever and re-wedge the build loop.
   *
   * Idempotent with TownBrain's in-memory `onCompleted` hook: when both fire
   * (no restart) updateBuildingStatus/deleteBuilding just run twice harmlessly.
   */
  onBuildCompleted(job: { townId?: string; buildingId?: string; jobId: string; status?: string; placedBlocks?: number; totalBlocks?: number; schematicFile?: string }): void {
    if (!job.townId) return;

    if (job.buildingId) {
      const ok = job.status === 'completed' || job.status === 'completed_with_errors';
      if (ok) {
        this.updateBuildingStatus(job.buildingId, 'complete');
      } else {
        // failed / cancelled — drop the row so the kind re-queues next tick
        // instead of the row holding the build loop's in-flight lock.
        this.deleteBuilding(job.buildingId);
      }
      logger.info(
        { townId: job.townId, buildingId: job.buildingId, jobId: job.jobId, status: job.status, resolved: ok ? 'complete' : 'deleted' },
        'TownManager: reconciled building row from build:completed',
      );
    }

    this.recordEvent({
      townId: job.townId,
      kind: 'build_completed',
      severity: 'info',
      payload: {
        jobId: job.jobId,
        status: job.status,
        placedBlocks: job.placedBlocks,
        totalBlocks: job.totalBlocks,
        schematicFile: job.schematicFile,
      },
      highlightScore: 20,
    });
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Disasters (Phase 5-A — Phoenix self-healing)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Insert a `disasters` row. Failures fall through to the JSONL fallback so
   * the Phoenix loop still surfaces every catastrophe even when the DB is
   * wedged. Returns the canonical Disaster (with the generated id).
   */
  // Disaster persistence is delegated to DisasterRepository.
  insertDisaster(input: {
    townId: string;
    kind: string;
    severity?: string | null;
    summary?: string | null;
    memorialMarkerId?: string | null;
    occurredAt?: number;
    dedupeKey?: string | null;
  }): Disaster {
    return this.disasters.insertDisaster(input);
  }

  updateDisasterMemorialMarker(disasterId: string, markerId: string | null): void {
    this.disasters.updateDisasterMemorialMarker(disasterId, markerId);
  }

  listDisasters(townId: string, opts: { limit?: number } = {}): Disaster[] {
    return this.disasters.listDisasters(townId, opts);
  }

  getDeadResidentsSince(townId: string, since: number): Resident[] {
    return this.disasters.getDeadResidentsSince(townId, since);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Approvals (Phase 6-B — voting + mayor-direct gating layer)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Insert a new approval row. JSONL fallback on DB failure so a wedged DB
   * never drops a pending decision. Returns the canonical Approval — the
   * caller (ApprovalManager) registers a `resolveOnce` handler keyed by id.
   */
  // Approvals persistence is delegated to ApprovalRepository (extracted).
  insertApproval(input: {
    townId: string;
    kind: ApprovalKind | string;
    payload: unknown;
    createdAt: number;
    expiresAt: number;
    status?: ApprovalStatus;
  }): Approval | null {
    return this.approvals.insertApproval(input);
  }

  updateApproval(
    approvalId: string,
    patch: {
      status?: ApprovalStatus;
      mayorDecision?: 'approved' | 'denied' | null;
      votes?: ApprovalVotes;
      expiresAt?: number;
    },
  ): boolean {
    return this.approvals.updateApproval(approvalId, patch);
  }

  listApprovals(
    townId: string,
    opts: { status?: ApprovalStatus | 'all'; limit?: number } = {},
  ): Approval[] {
    return this.approvals.listApprovals(townId, opts);
  }

  getApproval(approvalId: string): Approval | null {
    return this.approvals.getApproval(approvalId);
  }

  /**
   * Set (or clear, with null) an approval row's handler_descriptor_json. Owns
   * the column so ApprovalManager no longer opens its own second connection to
   * town.db (review #10 — connection consolidation + leak fix). Best-effort.
   */
  setApprovalDescriptor(approvalId: string, descriptorJson: string | null): void {
    try {
      this.handle.sqlite
        .prepare(`UPDATE approvals SET handler_descriptor_json = ? WHERE id = ?`)
        .run(descriptorJson, approvalId);
    } catch (err: any) {
      logger.warn({ err: err?.message, approvalId }, 'setApprovalDescriptor: UPDATE failed');
    }
  }

  /** Open approval rows that carry a persisted handler descriptor (for rehydrate). */
  listOpenApprovalsWithDescriptor(): Array<{ id: string; townId: string | null; descriptorJson: string | null }> {
    try {
      const rows = this.handle.sqlite
        .prepare(
          `SELECT id, town_id, handler_descriptor_json FROM approvals WHERE status = 'open' AND handler_descriptor_json IS NOT NULL`,
        )
        .all() as Array<{ id: string; town_id: string | null; handler_descriptor_json: string | null }>;
      return rows.map((r) => ({ id: r.id, townId: r.town_id, descriptorJson: r.handler_descriptor_json }));
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'listOpenApprovalsWithDescriptor: query failed');
      return [];
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Relationships (Phase 7-A — inter-town directed diplomacy edges)
  //
  //  One row per ordered (town_id_a, town_id_b) pair. DiplomacyManager calls
  //  these methods to mutate edges; the api.ts /relationships routes call
  //  the read-side methods.
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Upsert a directed edge. Atomic via SQLite ON CONFLICT — the unique index
   * is on (town_id_a, town_id_b). Returns true on success, false on
   * (logged) DB failure routed to the JSONL fallback.
   *
   * The fallback row carries the FULL Relationship payload (including the
   * events array) so a wedged DB doesn't lose history. drainFallback's
   * replay re-runs the same INSERT ... ON CONFLICT path.
   */
  // Relationship-edge persistence is delegated to RelationshipRepository.
  upsertRelationshipEdge(edge: Relationship): boolean {
    return this.relationships.upsertRelationshipEdge(edge);
  }

  getRelationshipEdge(a: string, b: string): Relationship | null {
    return this.relationships.getRelationshipEdge(a, b);
  }

  listRelationshipsFrom(townId: string): Relationship[] {
    return this.relationships.listRelationshipsFrom(townId);
  }

  listAllRelationships(): Relationship[] {
    return this.relationships.listAllRelationships();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Style observations (Phase 4 — feedback path)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Append a `style_observations` row. The `palette` blob is whatever the
   * caller wants to remember about a realized build (block frequencies,
   * dimensions, kind) — StyleObserver writes a structured object that
   * `updateFromObservations` in StyleDoc.ts knows how to read.
   *
   * Failures route to the JSONL fallback so the feedback loop survives a
   * wedged DB.
   */
  // Style-observation persistence is delegated to StyleObservationRepository.
  insertStyleObservation(townId: string, input: { buildingId: string | null; palette: unknown }): void {
    this.styleObservations.insertStyleObservation(townId, input);
  }

  getStyleObservations(townId: string) {
    return this.styleObservations.getStyleObservations(townId);
  }

  /**
   * Read the on-disk `style.json` for a town. Lives at
   * `<dataDir>/towns/<townId>/style.json`. Returns null when the file is
   * missing or malformed.
   */
  getStyleDoc(townId: string): unknown {
    // Lazy-require so test bundlers don't pull StyleDoc's deps eagerly.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { loadStyle } = require('./StyleDoc');
    return loadStyle(this.dataDir, townId);
  }

  /** Expose the data dir so peripheral modules (LlmDesigner, StyleObserver) can resolve files. */
  getDataDir(): string {
    return this.dataDir;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Fallback management
  // ──────────────────────────────────────────────────────────────────────

  private appendFallbackRow(kind: FallbackKind, townId: string, row: Record<string, unknown>): void {
    const entry: FallbackEntry = {
      kind,
      townId,
      row,
      enqueuedAt: Date.now(),
    };
    appendFallback(this.dataDir, entry);
  }

  /**
   * Drain any pending JSONL fallback files into the DB. Returns the number of
   * rows that were successfully re-inserted.
   */
  drainFallback(): number {
    const snapshots = readAllFallback(this.dataDir);
    if (snapshots.length === 0) return 0;
    let replayed = 0;
    for (const snap of snapshots) {
      let allOk = true;
      for (const entry of snap.entries) {
        try {
          this.replayFallbackEntry(entry);
          replayed++;
        } catch (err: any) {
          allOk = false;
          logger.warn({ err: err?.message, kind: entry.kind, townId: entry.townId }, 'Fallback replay failed; will retry next boot');
          break;
        }
      }
      if (allOk) clearFallbackFile(snap.filePath);
    }
    if (replayed > 0) {
      logger.info({ replayed }, 'Drained town fallback JSONL into DB');
    }
    return replayed;
  }

  private replayFallbackEntry(entry: FallbackEntry): void {
    const row = entry.row as any;
    switch (entry.kind) {
      case 'events':
        this.db
          .insert(schema.events)
          .values({
            id: row.id,
            townId: row.townId ?? entry.townId,
            kind: row.kind,
            severity: row.severity ?? null,
            payloadJson: row.payload == null ? null : JSON.stringify(row.payload),
            occurredAt: row.occurredAt,
            highlightScore: row.highlightScore ?? null,
          })
          .run();
        return;
      case 'chronicle':
        this.db
          .insert(schema.chronicleEntries)
          .values({
            id: row.id,
            townId: row.townId ?? entry.townId,
            dayNumber: row.dayNumber,
            kind: row.kind ?? null,
            body: row.body,
            generatedAt: row.generatedAt ?? null,
            model: row.model ?? null,
          })
          .run();
        return;
      case 'journals':
        this.db
          .insert(schema.botJournals)
          .values({
            id: row.id,
            townId: row.townId ?? entry.townId,
            botName: row.botName,
            dayNumber: row.dayNumber ?? null,
            body: row.body,
            generatedAt: row.generatedAt ?? null,
          })
          .run();
        return;
      case 'disasters':
        this.db
          .insert(schema.disasters)
          .values({
            id: row.id,
            townId: row.townId ?? entry.townId,
            kind: row.kind ?? null,
            severity: row.severity ?? null,
            occurredAt: row.occurredAt ?? null,
            memorialMarkerId: row.memorialMarkerId ?? null,
            summary: row.summary ?? null,
          })
          .run();
        return;
      case 'style_observations':
        this.db
          .insert(schema.styleObservations)
          .values({
            id: row.id,
            townId: row.townId ?? entry.townId,
            buildingId: row.buildingId ?? null,
            paletteJson: row.palette == null ? null : JSON.stringify(row.palette),
            recordedAt: row.recordedAt ?? null,
            included: row.included !== false,
          })
          .run();
        return;
      case 'approvals':
        this.db
          .insert(schema.approvals)
          .values({
            id: row.id,
            townId: row.townId ?? entry.townId,
            kind: row.kind,
            payloadJson: row.payload == null ? null : JSON.stringify(row.payload),
            status: row.status ?? 'open',
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            mayorDecision: row.mayorDecision ?? null,
            votesJson: row.votes == null ? null : JSON.stringify(row.votes),
          })
          .run();
        return;
      case 'relationships':
        // Re-run upsert semantics so a re-played row collapses cleanly into
        // an existing edge (which may have been updated since the fallback
        // was written). Skip emitting events on replay — the original
        // recordInteraction already emitted them on the live path.
        this.upsertRelationshipEdge({
          townIdA: row.townIdA ?? entry.townId,
          townIdB: row.townIdB ?? '',
          state: (row.state as RelationshipState) ?? 'neutral',
          trust: typeof row.trust === 'number' ? clampTrust(row.trust) : DEFAULT_TRUST,
          lastInteractionAt: row.lastInteractionAt ?? Date.now(),
          events: Array.isArray(row.events) ? (row.events as RelationshipEvent[]) : [],
        });
        return;
    }
  }
}
