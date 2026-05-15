/**
 * DesignCache — Phase 4 design persistence.
 *
 * The LLM design call costs real money, so we cache every validated plan to
 * `schematics/<townId>/<kind>-<hash>.json` and hand the path back on the next
 * matching request. The hash key is `style:kind:dims` so a style switch (or a
 * dimension bump) naturally invalidates older cache entries for the same
 * kind.
 *
 * Note: Phase 4 intentionally caches as JSON (not `.schem`). The build
 * coordinator currently reads `.schem` files via `prismarine-schematic`, so a
 * follow-up will either teach BuildCoordinator to consume JSON block plans
 * directly OR encode the block plan into a real `.schem` here. For now the
 * cache stores JSON; the build loop falls back to the library matcher when no
 * JSON-aware writer exists (see TownBrain.buildLoop).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import { logger } from '../util/logger';
import type { BlockPlan } from './LlmDesigner';

export interface DesignCacheInput {
  /** Town id; used as the cache directory name under `schematics/`. */
  townId: string;
  /** Building kind ('town_hall', 'house', etc.). */
  kind: string;
  /**
   * Style hash input. Caller provides the style preset id + dimensions string
   * (or anything stable); we re-hash so the path stays short.
   */
  styleHashInput: string;
}

export interface DesignCacheEntry {
  /** Absolute path to the cached file (`.json` today, `.schem` later). */
  filePath: string;
  /** Just the basename so consumers can hand it straight to BuildCoordinator. */
  filename: string;
  /** The cached plan (already parsed). */
  plan: BlockPlan;
  /** The hash key that produced the lookup, for telemetry. */
  hash: string;
}

const HASH_LENGTH = 10;

function hashStyleInput(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, HASH_LENGTH);
}

/**
 * Compose the stable hash input from the style preset, kind, and dims. Used by
 * callers to ensure the same plan-shape produces the same cache key.
 */
export function buildStyleHashInput(opts: {
  stylePreset: string;
  kind: string;
  dimensions: { w: number; h: number; d: number };
  /** Extra entropy if the caller wants to invalidate the cache deliberately. */
  extra?: string;
}): string {
  const { stylePreset, kind, dimensions, extra } = opts;
  return [stylePreset, kind, `${dimensions.w}x${dimensions.h}x${dimensions.d}`, extra ?? ''].join('|');
}

export class DesignCache {
  private readonly rootDir: string;

  /**
   * @param rootDir Absolute path to the `schematics/` directory. Town
   *   sub-folders are created on demand.
   */
  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private townDir(townId: string): string {
    return path.join(this.rootDir, townId);
  }

  private fileNameFor(kind: string, hash: string): string {
    // Always JSON for now — see file header note.
    return `${this.sanitizeKind(kind)}-${hash}.json`;
  }

  private sanitizeKind(kind: string): string {
    return kind.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  }

  /** Return the cached plan for the requested key, or null when missing. */
  get(input: DesignCacheInput): DesignCacheEntry | null {
    const hash = hashStyleInput(input.styleHashInput);
    const filename = this.fileNameFor(input.kind, hash);
    const filePath = path.join(this.townDir(input.townId), filename);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const plan = JSON.parse(raw) as BlockPlan;
      if (!plan || !Array.isArray(plan.blocks)) {
        logger.warn({ filePath }, 'DesignCache: cached file missing blocks array');
        return null;
      }
      return { filePath, filename, plan, hash };
    } catch (err: any) {
      logger.warn(
        { err: err?.message, filePath },
        'DesignCache: failed to read cached plan; treating as miss',
      );
      return null;
    }
  }

  /**
   * Persist the plan to disk. Returns the cache entry on success, null on
   * failure (caller should still use the in-memory plan if it wants).
   */
  save(input: DesignCacheInput, plan: BlockPlan): DesignCacheEntry | null {
    const hash = hashStyleInput(input.styleHashInput);
    const filename = this.fileNameFor(input.kind, hash);
    const filePath = path.join(this.townDir(input.townId), filename);
    try {
      atomicWriteJsonSync(filePath, plan);
      return { filePath, filename, plan, hash };
    } catch (err: any) {
      logger.warn(
        { err: err?.message, filePath },
        'DesignCache: failed to write cached plan',
      );
      return null;
    }
  }

  /** List every cached entry for a town. Used by the `/api/towns/:id/designs` route. */
  list(townId: string): Array<{ filename: string; kind: string; hash: string; size: number; mtimeMs: number }> {
    const dir = this.townDir(townId);
    if (!fs.existsSync(dir)) return [];
    const results: Array<{ filename: string; kind: string; hash: string; size: number; mtimeMs: number }> = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json') && !file.endsWith('.schem')) continue;
      const fp = path.join(dir, file);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(fp);
      } catch {
        continue;
      }
      // Filenames look like `<kind>-<hash>.json`; split on the last `-`.
      const base = file.replace(/\.(json|schem)$/, '');
      const dashIdx = base.lastIndexOf('-');
      const kind = dashIdx > 0 ? base.slice(0, dashIdx) : base;
      const hash = dashIdx > 0 ? base.slice(dashIdx + 1) : '';
      results.push({
        filename: file,
        kind,
        hash,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      });
    }
    return results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  }
}
