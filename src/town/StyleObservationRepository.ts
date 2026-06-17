/**
 * StyleObservationRepository — persistence for the style_observations feedback
 * table (Phase 4), extracted from TownManager (review: god-object
 * decomposition). Pure CRUD; write failures route to the JSONL fallback via an
 * injected callback. Note: the cross-table delete of style_observations on
 * building removal stays in the buildings path (deleteBuilding's transaction).
 */
import { desc, eq } from 'drizzle-orm';
import * as schema from './schema';
import type { TownDb } from './db';
import { genId, safeJsonParse } from './rows';
import { logger } from '../util/logger';
import type { FallbackAppend } from './ApprovalRepository';

export interface StyleObservationRecord {
  id: string;
  townId: string;
  buildingId: string | null;
  palette: unknown;
  recordedAt: number | null;
  included: boolean;
}

export class StyleObservationRepository {
  constructor(
    private readonly db: TownDb,
    private readonly fallbackAppend: FallbackAppend,
  ) {}

  insertStyleObservation(townId: string, input: { buildingId: string | null; palette: unknown }): void {
    const id = genId('sob');
    const recordedAt = Date.now();
    try {
      this.db
        .insert(schema.styleObservations)
        .values({
          id,
          townId,
          buildingId: input.buildingId,
          paletteJson: input.palette == null ? null : JSON.stringify(input.palette),
          recordedAt,
          included: true,
        })
        .run();
    } catch (err: any) {
      this.fallbackAppend('style_observations', townId, {
        id,
        townId,
        buildingId: input.buildingId,
        palette: input.palette,
        recordedAt,
        included: true,
      });
      logger.warn(
        { err: err?.message, townId, buildingId: input.buildingId },
        'insertStyleObservation: DB write failed; routed to fallback',
      );
    }
  }

  /** Read every style observation for a town, newest-first. */
  getStyleObservations(townId: string): StyleObservationRecord[] {
    const rows = this.db
      .select()
      .from(schema.styleObservations)
      .where(eq(schema.styleObservations.townId, townId))
      .orderBy(desc(schema.styleObservations.recordedAt))
      .all();
    return rows.map((row) => ({
      id: row.id,
      townId: row.townId ?? townId,
      buildingId: row.buildingId ?? null,
      palette: safeJsonParse<unknown>(row.paletteJson ?? null, null),
      recordedAt: row.recordedAt ?? null,
      included: row.included !== false,
    }));
  }
}
