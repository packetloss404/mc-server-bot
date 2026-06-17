/**
 * DisasterRepository — persistence for the disasters table (Phase 5),
 * extracted from TownManager (review: god-object decomposition). CRUD with
 * dedupe-key idempotency and JSONL-fallback on write failure. getDeadResidents
 * Since reads residents, so a residents reader is injected. TownManager keeps
 * thin delegating methods so PhoenixManager/DisasterRecorder are unaffected.
 */
import { and, desc, eq } from 'drizzle-orm';
import * as schema from './schema';
import type { TownDb } from './db';
import type { Disaster, Resident } from './Town';
import { genId } from './rows';
import { logger } from '../util/logger';
import type { FallbackAppend } from './ApprovalRepository';

export class DisasterRepository {
  constructor(
    private readonly db: TownDb,
    private readonly fallbackAppend: FallbackAppend,
    private readonly getResidents: (townId: string) => Resident[],
  ) {}

  insertDisaster(input: {
    townId: string;
    kind: string;
    severity?: string | null;
    summary?: string | null;
    memorialMarkerId?: string | null;
    occurredAt?: number;
    dedupeKey?: string | null;
  }): Disaster {
    // Idempotency: a supplied dedupeKey short-circuits to the existing row so a
    // restart re-scan never produces a duplicate disaster + monument.
    if (input.dedupeKey) {
      try {
        const existing = this.db
          .select()
          .from(schema.disasters)
          .where(and(eq(schema.disasters.townId, input.townId), eq(schema.disasters.dedupeKey, input.dedupeKey)))
          .limit(1)
          .all();
        if (existing.length > 0) {
          const r = existing[0];
          return {
            id: r.id,
            townId: r.townId ?? input.townId,
            kind: r.kind ?? input.kind,
            severity: r.severity ?? null,
            occurredAt: r.occurredAt ?? null,
            memorialMarkerId: r.memorialMarkerId ?? null,
            summary: r.summary ?? null,
            dedupeKey: r.dedupeKey ?? null,
          };
        }
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId: input.townId, dedupeKey: input.dedupeKey },
          'insertDisaster: dedupe lookup failed; proceeding with insert',
        );
      }
    }
    const id = genId('dst');
    const occurredAt = input.occurredAt ?? Date.now();
    const row = {
      id,
      townId: input.townId,
      kind: input.kind,
      severity: input.severity ?? null,
      occurredAt,
      memorialMarkerId: input.memorialMarkerId ?? null,
      summary: input.summary ?? null,
      dedupeKey: input.dedupeKey ?? null,
    };
    try {
      this.db.insert(schema.disasters).values(row).run();
    } catch (err: any) {
      this.fallbackAppend('disasters', input.townId, row);
      logger.warn(
        { err: err?.message, townId: input.townId, kind: input.kind },
        'insertDisaster: DB write failed; routed to fallback',
      );
    }
    return {
      id,
      townId: input.townId,
      kind: input.kind,
      severity: input.severity ?? null,
      occurredAt,
      memorialMarkerId: input.memorialMarkerId ?? null,
      summary: input.summary ?? null,
      dedupeKey: input.dedupeKey ?? null,
    };
  }

  updateDisasterMemorialMarker(disasterId: string, markerId: string | null): void {
    try {
      this.db
        .update(schema.disasters)
        .set({ memorialMarkerId: markerId })
        .where(eq(schema.disasters.id, disasterId))
        .run();
    } catch (err: any) {
      logger.warn({ err: err?.message, disasterId, markerId }, 'updateDisasterMemorialMarker: update failed');
    }
  }

  listDisasters(townId: string, opts: { limit?: number } = {}): Disaster[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
    const rows = this.db
      .select()
      .from(schema.disasters)
      .where(eq(schema.disasters.townId, townId))
      .orderBy(desc(schema.disasters.occurredAt))
      .limit(limit)
      .all();
    return rows.map((r): Disaster => ({
      id: r.id,
      townId: r.townId ?? townId,
      kind: r.kind ?? '',
      severity: r.severity ?? null,
      occurredAt: r.occurredAt ?? null,
      memorialMarkerId: r.memorialMarkerId ?? null,
      summary: r.summary ?? null,
      dedupeKey: r.dedupeKey ?? null,
    }));
  }

  /**
   * Residents in 'dead' status (filtered in-memory; the schema has no diedAt,
   * so `since` is advisory — PhoenixManager tracks handled ids itself).
   */
  getDeadResidentsSince(townId: string, _since: number): Resident[] {
    return this.getResidents(townId).filter((r) => r.status === 'dead');
  }
}
