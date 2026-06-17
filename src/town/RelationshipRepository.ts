/**
 * RelationshipRepository — persistence for inter-town diplomacy edges (Phase
 * 7-A), extracted from TownManager (review: god-object decomposition). Pure
 * CRUD over the shared drizzle connection; write failures route to the JSONL
 * fallback via an injected callback. TownManager keeps thin delegating methods
 * so DiplomacyManager + the api.ts /relationships routes are unaffected.
 */
import { and, eq } from 'drizzle-orm';
import * as schema from './schema';
import type { TownDb } from './db';
import type { Relationship } from './Relationship';
import { genId, rowToRelationship } from './rows';
import { clampTrust } from './diplomacy';
import { logger } from '../util/logger';
import type { FallbackAppend } from './ApprovalRepository';

export class RelationshipRepository {
  constructor(
    private readonly db: TownDb,
    private readonly fallbackAppend: FallbackAppend,
  ) {}

  /**
   * Upsert a directed edge. The unique index is on (town_id_a, town_id_b); we
   * look up the existing row to preserve its surrogate id rather than minting a
   * new one each tick. Returns false on a (logged) DB failure routed to JSONL.
   */
  upsertRelationshipEdge(edge: Relationship): boolean {
    const trust = clampTrust(edge.trust);
    const eventsJson = JSON.stringify(edge.events ?? []);
    try {
      const existing = this.db
        .select()
        .from(schema.relationships)
        .where(
          and(
            eq(schema.relationships.townIdA, edge.townIdA),
            eq(schema.relationships.townIdB, edge.townIdB),
          ),
        )
        .get();
      if (existing) {
        this.db
          .update(schema.relationships)
          .set({
            state: edge.state,
            trust,
            lastInteractionAt: edge.lastInteractionAt,
            eventsJson,
          })
          .where(eq(schema.relationships.id, existing.id))
          .run();
      } else {
        const id = genId('rel');
        this.db
          .insert(schema.relationships)
          .values({
            id,
            townIdA: edge.townIdA,
            townIdB: edge.townIdB,
            state: edge.state,
            trust,
            lastInteractionAt: edge.lastInteractionAt,
            eventsJson,
          })
          .run();
      }
      return true;
    } catch (err: any) {
      this.fallbackAppend('relationships', edge.townIdA, {
        townIdA: edge.townIdA,
        townIdB: edge.townIdB,
        state: edge.state,
        trust,
        lastInteractionAt: edge.lastInteractionAt,
        events: edge.events ?? [],
      });
      logger.warn(
        { err: err?.message, a: edge.townIdA, b: edge.townIdB },
        'upsertRelationshipEdge: DB write failed; routed to fallback',
      );
      return false;
    }
  }

  /** Single directed edge `a -> b`, or null when no edge exists. */
  getRelationshipEdge(a: string, b: string): Relationship | null {
    try {
      const row = this.db
        .select()
        .from(schema.relationships)
        .where(and(eq(schema.relationships.townIdA, a), eq(schema.relationships.townIdB, b)))
        .get();
      return row ? rowToRelationship(row) : null;
    } catch (err: any) {
      logger.warn({ err: err?.message, a, b }, 'getRelationshipEdge: read failed');
      return null;
    }
  }

  /** All outgoing edges from a town. */
  listRelationshipsFrom(townId: string): Relationship[] {
    try {
      const rows = this.db
        .select()
        .from(schema.relationships)
        .where(eq(schema.relationships.townIdA, townId))
        .all();
      return rows.map(rowToRelationship);
    } catch (err: any) {
      logger.warn({ err: err?.message, townId }, 'listRelationshipsFrom: read failed');
      return [];
    }
  }

  /** Every edge in the table. */
  listAllRelationships(): Relationship[] {
    try {
      const rows = this.db.select().from(schema.relationships).all();
      return rows.map(rowToRelationship);
    } catch (err: any) {
      logger.warn({ err: err?.message }, 'listAllRelationships: read failed');
      return [];
    }
  }
}
