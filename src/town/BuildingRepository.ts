/**
 * BuildingRepository — persistence for the buildings table, extracted from
 * TownManager (review: god-object decomposition). Pure CRUD; deleteBuilding
 * needs the raw sqlite handle for its cross-table transaction (it also clears
 * the building's style_observations children). No JSONL fallback — the brain
 * retries planned-row inserts next tick. TownManager keeps thin delegates so
 * TownBrain/api.ts are unaffected.
 */
import { eq } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import * as schema from './schema';
import type { TownDb } from './db';
import type { Building, Vec3 } from './Town';
import { genId } from './rows';
import { logger } from '../util/logger';

type BuildingRow = typeof schema.buildings.$inferSelect;

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

export class BuildingRepository {
  constructor(
    private readonly db: TownDb,
    private readonly sqlite: Database.Database,
  ) {}

  listBuildings(townId: string): Building[] {
    const rows = this.db.select().from(schema.buildings).where(eq(schema.buildings.townId, townId)).all();
    return rows.map(rowToBuilding);
  }

  /** Insert a `planned` building row (idempotent across brain ticks). */
  createPlannedBuilding(input: {
    townId: string;
    name: string;
    schematicSource?: string | null;
    schematicRef?: string | null;
    districtId?: string | null;
  }): Building {
    const id = genId('bld');
    const row = {
      id,
      townId: input.townId,
      districtId: input.districtId ?? null,
      name: input.name,
      schematicSource: input.schematicSource ?? null,
      schematicRef: input.schematicRef ?? null,
      originX: null,
      originY: null,
      originZ: null,
      width: null,
      height: null,
      depth: null,
      builtAt: null,
      destroyedAt: null,
      status: 'planned',
    };
    try {
      this.db.insert(schema.buildings).values(row).run();
    } catch (err: any) {
      // No JSONL fallback for buildings — the brain retries next tick.
      logger.warn(
        { err: err?.message, townId: input.townId, name: input.name },
        'createPlannedBuilding: insert failed; brain will retry next tick',
      );
    }
    return rowToBuilding(row as unknown as BuildingRow);
  }

  /** Attach a districtId to a building row (idempotent). */
  setBuildingDistrict(buildingId: string, districtId: string): boolean {
    try {
      const row = this.db.select().from(schema.buildings).where(eq(schema.buildings.id, buildingId)).get();
      if (!row) return false;
      if (row.districtId === districtId) return true;
      this.db.update(schema.buildings).set({ districtId }).where(eq(schema.buildings.id, buildingId)).run();
      return true;
    } catch (err: any) {
      logger.warn({ err: err?.message, buildingId, districtId }, 'setBuildingDistrict: update failed');
      return false;
    }
  }

  /** Flip a planned/building row's status. */
  updateBuildingStatus(
    buildingId: string,
    status: 'planned' | 'building' | 'complete' | 'damaged' | 'destroyed',
  ): void {
    try {
      this.db
        .update(schema.buildings)
        .set({ status, builtAt: status === 'complete' ? Date.now() : undefined })
        .where(eq(schema.buildings.id, buildingId))
        .run();
    } catch (err: any) {
      logger.warn({ err: err?.message, buildingId, status }, 'updateBuildingStatus: failed');
    }
  }

  /** Record where a planned building landed and flip it to building/complete. */
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
    try {
      this.db
        .update(schema.buildings)
        .set({
          originX: placement.origin.x,
          originY: placement.origin.y,
          originZ: placement.origin.z,
          width: placement.width ?? undefined,
          height: placement.height ?? undefined,
          depth: placement.depth ?? undefined,
          status: placement.status ?? 'building',
          builtAt: placement.status === 'complete' ? Date.now() : undefined,
        })
        .where(eq(schema.buildings.id, buildingId))
        .run();
    } catch (err: any) {
      logger.warn({ err: err?.message, buildingId }, 'recordBuildingPlacement: failed');
    }
  }

  /**
   * Hard-delete a building row. style_observations has an FK to buildings(id),
   * so drop the children first; both deletes run in one transaction so a crash
   * can't orphan observations (or vice-versa).
   */
  deleteBuilding(buildingId: string): void {
    try {
      this.sqlite.transaction(() => {
        this.db.delete(schema.styleObservations).where(eq(schema.styleObservations.buildingId, buildingId)).run();
        this.db.delete(schema.buildings).where(eq(schema.buildings.id, buildingId)).run();
      })();
    } catch (err: any) {
      logger.warn({ err: err?.message, buildingId }, 'deleteBuilding: failed');
    }
  }
}
