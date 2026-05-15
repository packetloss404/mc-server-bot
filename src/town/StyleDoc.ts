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
