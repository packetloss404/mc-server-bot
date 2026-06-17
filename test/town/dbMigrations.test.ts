/**
 * Town DB migration framework (user_version gating). Verifies a fresh DB is
 * stamped at TOWN_SCHEMA_VERSION with all migration-added columns present,
 * that reopening is idempotent, and that a legacy DB still at user_version 0
 * re-runs the (idempotent) migrations harmlessly and gets re-stamped.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { openTownDb, TOWN_SCHEMA_VERSION } from '../../src/town/db';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'town-db-mig-'));
}
function userVersion(sqlite: Database.Database): number {
  return Number(sqlite.pragma('user_version', { simple: true }));
}
function hasColumn(sqlite: Database.Database, table: string, col: string): boolean {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === col);
}

describe('town DB migrations (user_version framework)', () => {
  let dir: string;
  beforeEach(() => { dir = tmp(); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });

  it('stamps a fresh DB at TOWN_SCHEMA_VERSION with all migration columns present', () => {
    expect(TOWN_SCHEMA_VERSION).toBeGreaterThan(0);
    const h = openTownDb(dir);
    expect(userVersion(h.sqlite)).toBe(TOWN_SCHEMA_VERSION);
    expect(hasColumn(h.sqlite, 'towns', 'paused')).toBe(true);
    expect(hasColumn(h.sqlite, 'approvals', 'handler_descriptor_json')).toBe(true);
    expect(hasColumn(h.sqlite, 'disasters', 'dedupe_key')).toBe(true);
    h.sqlite.close();
  });

  it('is idempotent: reopening keeps the version and does not throw', () => {
    let h = openTownDb(dir);
    h.sqlite.close();
    h = openTownDb(dir);
    expect(userVersion(h.sqlite)).toBe(TOWN_SCHEMA_VERSION);
    h.sqlite.close();
  });

  it('re-runs migrations harmlessly when a legacy DB sits at user_version 0', () => {
    let h = openTownDb(dir);
    h.sqlite.pragma('user_version = 0'); // simulate a pre-framework DB
    h.sqlite.close();
    h = openTownDb(dir);
    expect(userVersion(h.sqlite)).toBe(TOWN_SCHEMA_VERSION);
    expect(hasColumn(h.sqlite, 'towns', 'paused')).toBe(true);
    h.sqlite.close();
  });
});
