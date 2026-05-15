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
  District,
  Resident,
  Town,
  TownConfig,
  TownEvent,
  Vec3,
  defaultDistrictBounds,
} from './Town';
import { openTownDb, TownDb, TownDbHandle } from './db';
import * as schema from './schema';
import {
  appendFallback,
  clearFallbackFile,
  FallbackEntry,
  FallbackKind,
  readAllFallback,
} from './fallback';
import { logger } from '../util/logger';

type TownRow = typeof schema.towns.$inferSelect;
type DistrictRow = typeof schema.districts.$inferSelect;
type ResidentRow = typeof schema.residents.$inferSelect;
type BuildingRow = typeof schema.buildings.$inferSelect;
type EventRow = typeof schema.events.$inferSelect;

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

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
}

export function townToDTO(town: Town, residents: Resident[]): TownDTO {
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
  };
}

function rowToDistrict(row: DistrictRow): District {
  return {
    id: row.id,
    townId: row.townId ?? '',
    name: row.name ?? null,
    stylePreset: row.stylePreset,
    bounds: safeJsonParse<unknown>(row.boundsJson ?? null, null),
    foundedAt: row.foundedAt,
    isDefault: row.isDefault === true,
  };
}

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

function rowToBuilding(row: BuildingRow): Building {
  const origin: Vec3 | null =
    row.originX != null && row.originY != null && row.originZ != null
      ? { x: row.originX, y: row.originY, z: row.originZ }
      : null;
  return {
    id: row.id,
    townId: row.townId ?? '',
    districtId: row.districtId ?? null,
    name: row.name ?? null,
    schematicSource: row.schematicSource ?? null,
    schematicRef: row.schematicRef ?? null,
    origin,
    width: row.width ?? null,
    height: row.height ?? null,
    depth: row.depth ?? null,
    builtAt: row.builtAt ?? null,
    destroyedAt: row.destroyedAt ?? null,
    status: row.status ?? null,
  };
}

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

  constructor(opts: TownManagerOptions = {}) {
    this.dataDir = opts.dataDir ?? path.join(process.cwd(), 'data');
    this.handle = opts.handle ?? openTownDb(this.dataDir);
    this.db = this.handle.db;
    // Drain any pending JSONL fallback into the DB at boot. Best-effort —
    // failures here are logged but never abort startup.
    this.drainFallback();
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Lifecycle
  // ──────────────────────────────────────────────────────────────────────

  shutdown(): void {
    try {
      this.handle.sqlite.close();
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'TownManager shutdown: close failed');
    }
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

    const district = this.createDefaultDistrict(id, input.capital, input.stylePreset, now);

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

  private createDefaultDistrict(
    townId: string,
    capital: Vec3,
    stylePreset: string,
    foundedAt: number,
  ): District {
    const id = genId('dist');
    const bounds = defaultDistrictBounds(capital);
    try {
      this.db
        .insert(schema.districts)
        .values({
          id,
          townId,
          name: 'Old Town',
          stylePreset,
          boundsJson: JSON.stringify(bounds),
          foundedAt,
          isDefault: true,
        })
        .run();
    } catch (err: any) {
      logger.error({ err: err?.message, townId }, 'Failed to insert founding district');
      throw err;
    }
    return {
      id,
      townId,
      name: 'Old Town',
      stylePreset,
      bounds,
      foundedAt,
      isDefault: true,
    };
  }

  listDistricts(townId: string): District[] {
    const rows = this.db
      .select()
      .from(schema.districts)
      .where(eq(schema.districts.townId, townId))
      .all();
    return rows.map(rowToDistrict);
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

  // ──────────────────────────────────────────────────────────────────────
  //  Buildings
  // ──────────────────────────────────────────────────────────────────────

  listBuildings(townId: string): Building[] {
    const rows = this.db
      .select()
      .from(schema.buildings)
      .where(eq(schema.buildings.townId, townId))
      .all();
    return rows.map(rowToBuilding);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Events — first-class observability surface
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Persist an event. Returns the canonical TownEvent regardless of whether
   * the row landed in SQLite or in the JSONL fallback.
   */
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

  // ──────────────────────────────────────────────────────────────────────
  //  Build-completion side channel (Phase 1 stub)
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Hook invoked by the existing BuildCoordinator's `build:completed` emit.
   * Phase 1 has no town↔build linkage yet, so when `townId` is omitted (the
   * common case today) this is a no-op. Once Phase 2 starts tagging build
   * jobs with their owning town this becomes the side channel that records a
   * `build_completed` event row.
   */
  onBuildCompleted(job: { townId?: string; jobId: string; status?: string; placedBlocks?: number; totalBlocks?: number; schematicFile?: string }): void {
    if (!job.townId) return;
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
    }
  }
}
