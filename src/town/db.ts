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
    summary TEXT,
    dedupe_key TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS style_observations (
    id TEXT PRIMARY KEY,
    town_id TEXT REFERENCES towns(id),
    building_id TEXT REFERENCES buildings(id),
    palette_json TEXT,
    recorded_at INTEGER,
    included INTEGER DEFAULT 1
  )`,
  // Phase 6-B — approvals queue (mayor-direct or resident-vote).
  // `handler_descriptor_json` (Phase 8-followup #57) lets the brain replay
  // the resolveOnce hook after a restart so an in-flight row that approves
  // while the process is down still fires its handler on next boot.
  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    town_id TEXT REFERENCES towns(id),
    kind TEXT NOT NULL,
    payload_json TEXT,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    mayor_decision TEXT,
    votes_json TEXT,
    handler_descriptor_json TEXT
  )`,
  // Phase 7-A — inter-town directed relationship edges. One row per ordered
  // (town_id_a, town_id_b) pair; supersedes the legacy towns.alliance_state
  // column for diplomacy logic (the column itself stays for back-compat).
  `CREATE TABLE IF NOT EXISTS relationships (
    id TEXT PRIMARY KEY,
    town_id_a TEXT REFERENCES towns(id),
    town_id_b TEXT REFERENCES towns(id),
    state TEXT NOT NULL,
    trust INTEGER NOT NULL,
    last_interaction_at INTEGER NOT NULL,
    events_json TEXT,
    UNIQUE (town_id_a, town_id_b)
  )`,
  // Indexes (spec section 10)
  `CREATE INDEX IF NOT EXISTS idx_events_town_time ON events(town_id, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_town_highlight ON events(town_id, highlight_score DESC, occurred_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_buildings_town_status ON buildings(town_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_chronicle_town_day ON chronicle_entries(town_id, day_number DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_disasters_dedupe ON disasters(town_id, dedupe_key)`,
  `CREATE INDEX IF NOT EXISTS idx_approvals_town_status ON approvals(town_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_relationships_a_state ON relationships(town_id_a, state)`,
];

/**
 * Migrations to apply on existing DBs that pre-date a schema change. Each entry
 * runs every boot and must be idempotent — wrap in try/catch where the SQL
 * itself isn't (sqlite ALTER TABLE doesn't support IF NOT EXISTS).
 */
const MIGRATIONS: Array<(sqlite: Database.Database) => void> = [
  // Phase 5: dedupe_key on disasters so PhoenixManager.scanDeaths is
  // idempotent across restarts (a known-bad death already in the table is
  // surfaced as the existing row, not a fresh duplicate).
  (sqlite) => {
    try {
      sqlite.exec(`ALTER TABLE disasters ADD COLUMN dedupe_key TEXT`);
    } catch (err: any) {
      // SQLite throws "duplicate column name" if it already exists — fine.
      if (!/duplicate column/i.test(String(err?.message ?? ''))) throw err;
    }
  },
  // Phase 8-followup #57: handler_descriptor_json on approvals lets
  // ApprovalManager re-register the resolveOnce handler after a restart so
  // an open row that approves while the process is down still executes its
  // proposer-side action on next boot.
  (sqlite) => {
    try {
      sqlite.exec(`ALTER TABLE approvals ADD COLUMN handler_descriptor_json TEXT`);
    } catch (err: any) {
      if (!/duplicate column/i.test(String(err?.message ?? ''))) throw err;
    }
  },
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
  for (const migrate of MIGRATIONS) {
    migrate(sqlite);
  }

  const db = drizzle(sqlite, { schema });
  logger.info({ dbPath }, 'Town DB initialized');
  return { db, sqlite, dbPath };
}
