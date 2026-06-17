/**
 * DistrictRepository — persistence for the districts table, extracted from
 * TownManager (review: god-object decomposition). Pure CRUD (no JSONL
 * fallback); createDistrict validates the town via an injected getTown reader.
 * createDefaultDistrict throws on insert failure (the founding district is
 * required for a valid town) — TownManager.createTown relies on that.
 */
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import type { TownDb } from './db';
import type { District, Town, Vec3 } from './Town';
import { defaultDistrictBounds } from './Town';
import { genId, safeJsonParse } from './rows';
import { logger } from '../util/logger';

type DistrictRow = typeof schema.districts.$inferSelect;

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

export class DistrictRepository {
  constructor(
    private readonly db: TownDb,
    private readonly getTown: (townId: string) => Town | null,
  ) {}

  /** Founding "Old Town" district. Throws on insert failure (required for a valid town). */
  createDefaultDistrict(townId: string, capital: Vec3, stylePreset: string, foundedAt: number): District {
    const id = genId('dist');
    const bounds = defaultDistrictBounds(capital);
    try {
      this.db
        .insert(schema.districts)
        .values({ id, townId, name: 'Old Town', stylePreset, boundsJson: JSON.stringify(bounds), foundedAt, isDefault: true })
        .run();
    } catch (err: any) {
      logger.error({ err: err?.message, townId }, 'Failed to insert founding district');
      throw err;
    }
    return { id, townId, name: 'Old Town', stylePreset, bounds, foundedAt, isDefault: true };
  }

  listDistricts(townId: string): District[] {
    const rows = this.db.select().from(schema.districts).where(eq(schema.districts.townId, townId)).all();
    return rows.map(rowToDistrict);
  }

  /**
   * Public district insertion (tier-up / admin). Derives a default bounding box
   * around `center`. Returns null when the town is missing or the insert fails.
   */
  createDistrict(input: {
    townId: string;
    name: string;
    stylePreset: string;
    center: Vec3;
    isDefault?: boolean;
  }): District | null {
    if (!this.getTown(input.townId)) return null;
    const id = genId('dist');
    const foundedAt = Date.now();
    const bounds = defaultDistrictBounds(input.center);
    try {
      this.db
        .insert(schema.districts)
        .values({
          id,
          townId: input.townId,
          name: input.name,
          stylePreset: input.stylePreset,
          boundsJson: JSON.stringify(bounds),
          foundedAt,
          isDefault: input.isDefault === true,
        })
        .run();
    } catch (err: any) {
      logger.warn({ err: err?.message, townId: input.townId, name: input.name }, 'createDistrict: insert failed');
      return null;
    }
    return {
      id,
      townId: input.townId,
      name: input.name,
      stylePreset: input.stylePreset,
      bounds,
      foundedAt,
      isDefault: input.isDefault === true,
    };
  }
}
