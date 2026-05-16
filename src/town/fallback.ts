/**
 * JSONL fallback writer.
 *
 * When a DB write throws (database locked, disk full, corrupted file, etc.)
 * the row is appended to `data/towns/<townId>/<kind>.jsonl` so we never drop
 * an event. On next boot — or when explicitly drained — `drainFallback` reads
 * each line, replays it into the DB, and (on success) truncates the file.
 *
 * Lines are pure JSON; the file is append-only between drains.
 */
import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';

export type FallbackKind =
  | 'events'
  | 'chronicle'
  | 'journals'
  | 'disasters'
  | 'style_observations'
  | 'approvals'
  | 'relationships';

export interface FallbackEntry {
  kind: FallbackKind;
  townId: string;
  /** The row to be inserted (camelCase fields, matching the Town* model). */
  row: Record<string, unknown>;
  /** When the original write attempt happened. */
  enqueuedAt: number;
}

function townDir(baseDir: string, townId: string): string {
  return path.join(baseDir, 'towns', townId);
}

function filePath(baseDir: string, townId: string, kind: FallbackKind): string {
  return path.join(townDir(baseDir, townId), `${kind}.jsonl`);
}

/**
 * Append a fallback record. Safe to call from inside a DB-write catch block —
 * any IO failure here is logged but never rethrown.
 */
export function appendFallback(baseDir: string, entry: FallbackEntry): void {
  try {
    const dir = townDir(baseDir, entry.townId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const line = JSON.stringify({
      kind: entry.kind,
      townId: entry.townId,
      row: entry.row,
      enqueuedAt: entry.enqueuedAt,
    }) + '\n';
    fs.appendFileSync(filePath(baseDir, entry.townId, entry.kind), line, 'utf-8');
    logger.warn(
      { townId: entry.townId, kind: entry.kind },
      'Town DB write failed; row written to JSONL fallback',
    );
  } catch (err: any) {
    logger.error(
      { err: err?.message, townId: entry.townId, kind: entry.kind },
      'Failed to append town fallback JSONL (data may be lost)',
    );
  }
}

export interface FallbackFileSnapshot {
  kind: FallbackKind;
  townId: string;
  filePath: string;
  entries: FallbackEntry[];
}

/**
 * Read every pending fallback file under `data/towns/`. Caller is responsible
 * for replaying the entries and then calling `clearFallbackFile` once the DB
 * has accepted them.
 */
export function readAllFallback(baseDir: string): FallbackFileSnapshot[] {
  const townsDir = path.join(baseDir, 'towns');
  if (!fs.existsSync(townsDir)) return [];
  const snapshots: FallbackFileSnapshot[] = [];
  for (const townId of fs.readdirSync(townsDir)) {
    const dir = path.join(townsDir, townId);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(dir);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue;
      const kind = file.replace(/\.jsonl$/, '') as FallbackKind;
      const fp = path.join(dir, file);
      let raw: string;
      try {
        raw = fs.readFileSync(fp, 'utf-8');
      } catch (err: any) {
        logger.warn({ err: err?.message, fp }, 'Failed to read town fallback file');
        continue;
      }
      const entries: FallbackEntry[] = [];
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed) as FallbackEntry);
        } catch (err: any) {
          logger.warn({ err: err?.message, line: trimmed.slice(0, 200) }, 'Skipping malformed fallback line');
        }
      }
      if (entries.length > 0) {
        snapshots.push({ kind, townId, filePath: fp, entries });
      }
    }
  }
  return snapshots;
}

/**
 * Truncate the fallback file after entries have been successfully replayed.
 */
export function clearFallbackFile(fp: string): void {
  try {
    fs.unlinkSync(fp);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') {
      logger.warn({ err: err?.message, fp }, 'Failed to remove drained fallback file');
    }
  }
}
