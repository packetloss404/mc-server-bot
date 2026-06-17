/**
 * ChronicleRepository — persistence for chronicle_entries + bot_journals,
 * extracted from TownManager (review: god-object decomposition). CRUD with
 * JSONL-fallback on write failure (injected callback). getChronicleDayNumber
 * needs a town's foundedAt, so a getTown reader is injected. TownManager keeps
 * thin delegating methods so ChronicleGenerator/scheduler are unaffected.
 */
import { and, desc, eq } from 'drizzle-orm';
import * as schema from './schema';
import type { TownDb } from './db';
import type { Town } from './Town';
import type {
  ChronicleEntry,
  ChronicleEntryInput,
  BotJournalEntry,
  BotJournalInput,
} from './TownManager';
import { genId } from './rows';
import { logger } from '../util/logger';
import type { FallbackAppend } from './ApprovalRepository';

type ChronicleRow = typeof schema.chronicleEntries.$inferSelect;
type JournalRow = typeof schema.botJournals.$inferSelect;

function rowToChronicle(row: ChronicleRow): ChronicleEntry {
  return {
    id: row.id,
    townId: row.townId ?? '',
    dayNumber: row.dayNumber,
    kind: (row.kind as ChronicleEntry['kind']) ?? 'daily',
    body: row.body,
    generatedAt: row.generatedAt ?? null,
    model: row.model ?? null,
  };
}

function rowToJournal(row: JournalRow): BotJournalEntry {
  return {
    id: row.id,
    townId: row.townId ?? '',
    botName: row.botName,
    dayNumber: row.dayNumber ?? null,
    body: row.body,
    generatedAt: row.generatedAt ?? null,
  };
}

export class ChronicleRepository {
  constructor(
    private readonly db: TownDb,
    private readonly fallbackAppend: FallbackAppend,
    private readonly getTown: (townId: string) => Town | null,
  ) {}

  insertChronicleEntry(input: ChronicleEntryInput): ChronicleEntry {
    const id = genId('chr');
    const generatedAt = input.generatedAt ?? Date.now();
    const entry: ChronicleEntry = {
      id,
      townId: input.townId,
      dayNumber: input.dayNumber,
      kind: input.kind,
      body: input.body,
      generatedAt,
      model: input.model ?? null,
    };
    try {
      this.db
        .insert(schema.chronicleEntries)
        .values({
          id,
          townId: input.townId,
          dayNumber: input.dayNumber,
          kind: input.kind,
          body: input.body,
          generatedAt,
          model: input.model ?? null,
        })
        .run();
    } catch (err: any) {
      this.fallbackAppend('chronicle', input.townId, {
        id,
        townId: input.townId,
        dayNumber: input.dayNumber,
        kind: input.kind,
        body: input.body,
        generatedAt,
        model: input.model ?? null,
      });
      logger.warn(
        { err: err?.message, townId: input.townId, dayNumber: input.dayNumber },
        'insertChronicleEntry: DB write failed; routed to fallback',
      );
    }
    return entry;
  }

  listChronicleEntries(
    townId: string,
    opts: { limit?: number; kind?: ChronicleEntry['kind'] } = {},
  ): ChronicleEntry[] {
    const limit = Math.min(Math.max(opts.limit ?? 7, 1), 100);
    const whereExpr = opts.kind
      ? and(eq(schema.chronicleEntries.townId, townId), eq(schema.chronicleEntries.kind, opts.kind))
      : eq(schema.chronicleEntries.townId, townId);
    const rows = this.db
      .select()
      .from(schema.chronicleEntries)
      .where(whereExpr)
      .orderBy(desc(schema.chronicleEntries.dayNumber), desc(schema.chronicleEntries.generatedAt))
      .limit(limit)
      .all();
    return rows.map(rowToChronicle);
  }

  getDailyChronicle(townId: string, dayNumber: number): ChronicleEntry | null {
    const row = this.db
      .select()
      .from(schema.chronicleEntries)
      .where(
        and(
          eq(schema.chronicleEntries.townId, townId),
          eq(schema.chronicleEntries.dayNumber, dayNumber),
          eq(schema.chronicleEntries.kind, 'daily'),
        ),
      )
      .get();
    return row ? rowToChronicle(row) : null;
  }

  /**
   * Chronicle day number from a town's foundedAt. One Minecraft day ≈ 20 real
   * minutes; day 1 is the first window (clamped at 1). Null for missing towns.
   */
  getChronicleDayNumber(townId: string, now: number = Date.now()): number | null {
    const town = this.getTown(townId);
    if (!town) return null;
    const elapsed = Math.max(0, now - town.foundedAt);
    const dayMs = 20 * 60 * 1000;
    return Math.max(1, Math.floor(elapsed / dayMs) + 1);
  }

  insertBotJournal(input: BotJournalInput): BotJournalEntry {
    const id = genId('jrn');
    const generatedAt = input.generatedAt ?? Date.now();
    const entry: BotJournalEntry = {
      id,
      townId: input.townId,
      botName: input.botName,
      dayNumber: input.dayNumber ?? null,
      body: input.body,
      generatedAt,
    };
    try {
      this.db
        .insert(schema.botJournals)
        .values({
          id,
          townId: input.townId,
          botName: input.botName,
          dayNumber: input.dayNumber ?? null,
          body: input.body,
          generatedAt,
        })
        .run();
    } catch (err: any) {
      this.fallbackAppend('journals', input.townId, {
        id,
        townId: input.townId,
        botName: input.botName,
        dayNumber: input.dayNumber ?? null,
        body: input.body,
        generatedAt,
      });
      logger.warn(
        { err: err?.message, townId: input.townId, botName: input.botName },
        'insertBotJournal: DB write failed; routed to fallback',
      );
    }
    return entry;
  }

  listBotJournals(
    townId: string,
    opts: { botName?: string; limit?: number } = {},
  ): BotJournalEntry[] {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 200);
    const whereExpr = opts.botName
      ? and(eq(schema.botJournals.townId, townId), eq(schema.botJournals.botName, opts.botName))
      : eq(schema.botJournals.townId, townId);
    const rows = this.db
      .select()
      .from(schema.botJournals)
      .where(whereExpr)
      .orderBy(desc(schema.botJournals.generatedAt))
      .limit(limit)
      .all();
    return rows.map(rowToJournal);
  }
}
