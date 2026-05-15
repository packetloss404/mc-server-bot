/**
 * SQLite (via better-sqlite3) + Drizzle ORM connection for the Town Builder.
 *
 * Migration strategy
 * ------------------
 * Phase 1 uses programmatic schema-push: we run `CREATE TABLE IF NOT EXISTS`
 * statements at boot, mirroring the Drizzle table definitions in `schema.ts`.
 * This avoids dragging `drizzle-kit` into the TypeScript build (the kit ships
 * its own ESM bundler and its TS config does not play nicely with the strict
 * commonjs target used here). `drizzle-kit push` remains the eventual
 * direction; when we move off SQLite (or when Drizzle ships first-class
 * runtime migrations for sqlite) we can switch with no schema rewrite — the
 * declarative tables live in `schema.ts` either way.
 *
 * The CREATE statements below are kept Postgres-compatible (text PKs,
 * INTEGER epoch timestamps, text-encoded JSON, integer-as-boolean) so the
 * same logical schema can be lifted into Postgres with only the engine-
 * specific `INTEGER PRIMARY KEY` -> `TEXT PRIMARY KEY` already in place.
 */
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import { logger } from '../util/logger';

export type TownDb = BetterSQLite3Database<typeof schema>;

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS towns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    founded_at INTEGER NOT NULL,
    capital_x INTEGER,
    capital_y INTEGER,
    capital_z INTEGER,
    tier TEXT CHECK (tier IN ('founding','village','town')),
    status TEXT CHECK (status IN ('active','dormant','abandoned')),
    population_target INTEGER,
    alliance_state TEXT,
    parent_town_id TEXT,
    style_seed TEXT,
    config_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS residents (
    id TEXT PRIMARY KEY,
    town_id TEXT REFERENCES towns(id),
    bot_name TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    current_role TEXT,
    status TEXT,
    UNIQUE (town_id, bot_name)
  )`,
  `CREATE TABLE IF NOT EXISTS districts (
    id TEXT PRIMARY KEY,
    town_id TEXT REFERENCES towns(id),
    name TEXT,
    style_preset TEXT NOT NULL,
    bounds_json TEXT,
    founded_at INTEGER NOT NULL,
    is_default INTEGER DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY,
    town_id TEXT REFERENCES towns(id),
    district_id TEXT REFERENCES districts(id),
    name TEXT,
    schematic_source TEXT,
    schematic_ref TEXT,
    origin_x INTEGER,
    origin_y INTEGER,
    origin_z INTEGER,
    width INTEGER,
    height INTEGER,
    depth INTEGER,
    built_at INTEGER,
    destroyed_at INTEGER,
    status TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    town_id TEXT REFERENCES towns(id),
    kind TEXT NOT NULL,
    severity TEXT,
    payload_json TEXT,
    occurred_at INTEGER NOT NULL,
    highlight_score INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS chronicle_entries (
    id TEXT PRIMARY KEY,
    town_id TEXT REFERENCES towns(id),
    day_number INTEGER NOT NULL,
    kind TEXT,
    body TEXT NOT NULL,
    generated_at INTEGER,
    model TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS bot_journals (
    id TEXT PRIMARY KEY,
    town_id TEXT REFERENCES towns(id),
    bot_name TEXT NOT NULL,
    day_number INTEGER,
    body TEXT NOT NULL,
    generated_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS disasters (
    id TEXT PRIMARY KEY,
    town_id TEXT REFERENCES towns(id),
    kind TEXT,
    severity TEXT,
    occurred_at INTEGER,
    memorial_marker_id TEXT,
    summary TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS style_observations (
    id TEXT PRIMARY KEY,
    town_id TEXT REFERENCES towns(id),
    building_id TEXT REFERENCES buildings(id),
    palette_json TEXT,
    recorded_at INTEGER,
    included INTEGER DEFAULT 1
  )`,
  // Indexes (spec section 10)
  `CREATE INDEX IF NOT EXISTS idx_events_town_time ON events(town_id, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_town_highlight ON events(town_id, highlight_score DESC, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_buildings_town_status ON buildings(town_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_chronicle_town_day ON chronicle_entries(town_id, day_number DESC)`,
];

export interface TownDbHandle {
  db: TownDb;
  sqlite: Database.Database;
  dbPath: string;
}

/**
 * Open the town DB, ensuring the parent directory and tables exist.
 * Caller is responsible for closing via `handle.sqlite.close()` at shutdown.
 */
export function openTownDb(dataDir: string = path.join(process.cwd(), 'data')): TownDbHandle {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, 'town.db');
  const sqlite = new Database(dbPath);
  // WAL gives us safer concurrent reads while writes are happening, and is
  // friendly to crash-recovery — matches the resilience posture this feature
  // wants given the JSONL fallback layer.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  for (const stmt of CREATE_STATEMENTS) {
    sqlite.exec(stmt);
  }

  const db = drizzle(sqlite, { schema });
  logger.info({ dbPath }, 'Town DB initialized');
  return { db, sqlite, dbPath };
}
