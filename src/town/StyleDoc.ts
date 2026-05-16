/**
 * StyleDoc — emergent town style descriptor (Phase 2 seed).
 *
 * The style doc is a JSON blob the town consults whenever it queues a new
 * building. At founding we drop one of two starter seeds (medieval-communal
 * or mid-century-civic) at `data/towns/<townId>/style.json`. From there the
 * Elder reflection loop (Phase 4) will evolve it as buildings succeed.
 *
 * This module owns:
 *   - the `StyleDoc` type
 *   - the two starter seeds (medieval / mid-century)
 *   - read/write helpers (`loadStyle`, `writeStyle`)
 *
 * The LLM-design pipeline (other agent, future) reads via `loadStyle`. The
 * TownManager writes the seed via `writeStyle` at town creation.
 */
import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import { logger } from '../util/logger';

export type StyleSeed = 'medieval-communal' | 'mid-century-civic';
export type RoofStyle = 'flat' | 'gabled' | 'hipped' | 'pyramidal';
export type WindowStyle = 'tall_rectangular' | 'small_leaded' | 'modern_strip';

export interface StyleDocDimensions {
  house_avg: { w: number; h: number; d: number };
  civic_avg: { w: number; h: number; d: number };
}

export interface StyleDocPalette {
  /** Most-used block types — walls, primary mass. */
  common: string[];
  /** Less common, distinctive blocks — trim, fixtures. */
  accent: string[];
  /** Roof material. */
  roof: string[];
  /** Floor / interior surface. */
  floor: string[];
}

export interface StyleDocPatterns {
  roof_style: RoofStyle;
  wall_height_typical: number;
  windows: WindowStyle;
  /** Free-form tags — `'columned_entry'`, `'half_timbered'`, etc. */
  facade_features: string[];
}

export interface StyleDoc {
  townId: string;
  lastObservedAt: number;
  block_palette: StyleDocPalette;
  dimensions: StyleDocDimensions;
  patterns: StyleDocPatterns;
  seed_style: StyleSeed;
}

// ─── File layout ──────────────────────────────────────────────────────────

/**
 * Resolve the absolute path to a town's `style.json`.
 * Lives at `<dataDir>/towns/<townId>/style.json`.
 */
export function styleDocPath(dataDir: string, townId: string): string {
  return path.join(dataDir, 'towns', townId, 'style.json');
}

/**
 * Read the on-disk style doc for a town. Returns `null` when the file does
 * not exist or fails to parse — the future LLM-design path treats `null` as
 * "fall back to the founding preset."
 */
export function loadStyle(dataDir: string, townId: string): StyleDoc | null {
  const file = styleDocPath(dataDir, townId);
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw) as StyleDoc;
    return parsed;
  } catch (err: any) {
    logger.warn({ err: err?.message, townId, file }, 'loadStyle: read/parse failed');
    return null;
  }
}

/**
 * Atomically write a style doc to disk. Wrapped in try/catch — callers
 * (e.g. TownManager.createTown) treat write failures as non-fatal so a wedged
 * filesystem can't block town founding.
 */
export function writeStyle(dataDir: string, doc: StyleDoc): boolean {
  const file = styleDocPath(dataDir, doc.townId);
  try {
    atomicWriteJsonSync(file, doc);
    return true;
  } catch (err: any) {
    logger.warn({ err: err?.message, townId: doc.townId, file }, 'writeStyle: failed');
    return false;
  }
}

// ─── Phase 4: feedback aggregation ────────────────────────────────────────

/**
 * Shape we accept from TownManager.getStyleObservations(): each row is a
 * `style_observations` record whose `palette` blob carries the per-build
 * frequency snapshot StyleObserver wrote in. We aggregate across all rows to
 * produce a "what the town has actually been built from" palette.
 */
export interface StyleObservationRow {
  buildingId: string | null;
  /** The full `palette` JSON written by StyleObserver. */
  palette: unknown;
  recordedAt: number | null;
  included: boolean;
}

interface ObservationPalette {
  wall?: Array<{ name: string; count: number }>;
  roof?: Array<{ name: string; count: number }>;
  floor?: Array<{ name: string; count: number }>;
  accent?: Array<{ name: string; count: number }>;
  dimensions?: { w: number; h: number; d: number };
  kind?: string;
  totalBlocks?: number;
}

/** How many recent observations to weight when re-aggregating. */
const RECENT_WINDOW = 25;

function topNames(rows: Array<{ name: string; count: number }>, n: number): string[] {
  return rows
    .sort((a, b) => b.count - a.count)
    .slice(0, n)
    .map((r) => r.name);
}

/**
 * Aggregate observation rows into a fresh StyleDoc and write it to disk. The
 * seed style is preserved (we never "forget" the founding preset) but the
 * realized palette and dimensions evolve toward what the town has actually
 * built. Safe to call from a build-completion hook — failures are swallowed.
 */
export function updateFromObservations(
  dataDir: string,
  townId: string,
  observations: StyleObservationRow[],
): boolean {
  const current = loadStyle(dataDir, townId);
  if (!current) {
    // No style.json on disk — nothing to evolve. (Seed should always exist
    // because createTown writes it.)
    return false;
  }
  // Sort newest-first and take the recent window.
  const recent = [...observations]
    .filter((o) => o.included && o.palette && typeof o.palette === 'object')
    .sort((a, b) => (b.recordedAt ?? 0) - (a.recordedAt ?? 0))
    .slice(0, RECENT_WINDOW);
  if (recent.length === 0) return false;

  // Aggregate counts across observations.
  const tally = {
    wall: new Map<string, number>(),
    roof: new Map<string, number>(),
    floor: new Map<string, number>(),
    accent: new Map<string, number>(),
  };
  let totalHouseW = 0, totalHouseH = 0, totalHouseD = 0, houseCount = 0;
  let totalCivicW = 0, totalCivicH = 0, totalCivicD = 0, civicCount = 0;
  for (const obs of recent) {
    const p = obs.palette as ObservationPalette;
    for (const role of ['wall', 'roof', 'floor', 'accent'] as const) {
      const list = p[role] ?? [];
      for (const { name, count } of list) {
        tally[role].set(name, (tally[role].get(name) ?? 0) + count);
      }
    }
    if (p.dimensions) {
      if (p.kind === 'house') {
        totalHouseW += p.dimensions.w;
        totalHouseH += p.dimensions.h;
        totalHouseD += p.dimensions.d;
        houseCount++;
      } else {
        totalCivicW += p.dimensions.w;
        totalCivicH += p.dimensions.h;
        totalCivicD += p.dimensions.d;
        civicCount++;
      }
    }
  }

  // Build the evolved palette. Keep the seed entries at the back so we never
  // lose the founding identity if a few unusual builds dominate the tally.
  const tallyToRanked = (m: Map<string, number>) =>
    [...m].map(([name, count]) => ({ name, count }));
  const merged: StyleDocPalette = {
    common: dedupe([...topNames(tallyToRanked(tally.wall), 4), ...current.block_palette.common]),
    accent: dedupe([...topNames(tallyToRanked(tally.accent), 4), ...current.block_palette.accent]),
    roof: dedupe([...topNames(tallyToRanked(tally.roof), 3), ...current.block_palette.roof]),
    floor: dedupe([...topNames(tallyToRanked(tally.floor), 3), ...current.block_palette.floor]),
  };

  const next: StyleDoc = {
    ...current,
    lastObservedAt: Date.now(),
    block_palette: merged,
    dimensions: {
      house_avg:
        houseCount > 0
          ? {
              w: Math.round(totalHouseW / houseCount),
              h: Math.round(totalHouseH / houseCount),
              d: Math.round(totalHouseD / houseCount),
            }
          : current.dimensions.house_avg,
      civic_avg:
        civicCount > 0
          ? {
              w: Math.round(totalCivicW / civicCount),
              h: Math.round(totalCivicH / civicCount),
              d: Math.round(totalCivicD / civicCount),
            }
          : current.dimensions.civic_avg,
    },
  };

  return writeStyle(dataDir, next);
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    if (!item) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result.slice(0, 8);
}
