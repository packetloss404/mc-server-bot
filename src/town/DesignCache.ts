/**
 * DesignCache — Phase 4 design persistence + Phase 5 follow-up #44.
 *
 * The LLM design call costs real money, so we cache every validated plan to
 * `schematics/<townId>/<kind>-<hash>.json` and hand the path back on the next
 * matching request. The hash key is `style:kind:dims` so a style switch (or a
 * dimension bump) naturally invalidates older cache entries for the same
 * kind.
 *
 * Followup #44: on save, we also encode the BlockPlan into a real Sponge v2
 * `.schem` byte buffer (via SchematicEncoder) and write it as a companion
 * file at `schematics/<townId>/<kind>-<hash>.schem`. BuildCoordinator can
 * then swing the LLM's actual geometry without falling back to the library
 * matcher. The JSON file stays as the source of truth for the design pipeline
 * (chronicle/observer introspection); the .schem is purely the build artefact.
 *
 * On encoder failure (oversized plan, unknown registry, etc.) we log a warn
 * and keep only the JSON entry — the caller falls back to SchematicMatcher
 * just like before.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import { logger } from '../util/logger';
import type { BlockPlan } from './LlmDesigner';
import { encodeAndSave, SchematicEncodeError } from './SchematicEncoder';

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
  /** Absolute path to the JSON cache file. */
  filePath: string;
  /** Just the JSON basename (kept for back-compat with earlier callers). */
  filename: string;
  /** The cached plan (already parsed). */
  plan: BlockPlan;
  /** The hash key that produced the lookup, for telemetry. */
  hash: string;
  /**
   * Absolute path to the companion `.schem` if it exists / was just encoded.
   * Null when the encoder failed or the legacy entry was JSON-only and the
   * lazy re-encode also failed.
   */
  schemPath?: string | null;
  /** Just the `.schem` basename — what BuildCoordinator wants. */
  schemFilename?: string | null;
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
    return `${this.sanitizeKind(kind)}-${hash}.json`;
  }

  /** Companion .schem filename for the same (kind, hash) pair. */
  private schemFileNameFor(kind: string, hash: string): string {
    return `${this.sanitizeKind(kind)}-${hash}.schem`;
  }

  private sanitizeKind(kind: string): string {
    return kind.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  }

  /**
   * Return the cached plan for the requested key, or null when missing.
   *
   * Followup #44: when a JSON entry exists but its `.schem` companion does
   * not (legacy cache), we lazily re-encode and write the .schem so the next
   * build call has a buildable file. Lazy-encode failures are logged but the
   * JSON entry is still returned (caller falls back to library).
   */
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
      const schemFilename = this.schemFileNameFor(input.kind, hash);
      const schemPath = path.join(this.townDir(input.townId), schemFilename);
      let schemExists = fs.existsSync(schemPath);
      if (!schemExists) {
        // Legacy entry from before #44 — try to materialise the .schem
        // companion now so the build coordinator has a buildable file. Async
        // void: callers shouldn't have to await a cache hit, and the next
        // tick will catch up if encoding takes a beat. Best-effort.
        encodeAndSave(plan, {
          rootDir: this.rootDir,
          townId: input.townId,
          filename: schemFilename,
        }).then(
          (res) => {
            logger.info(
              { townId: input.townId, kind: input.kind, schem: res.filename, bytes: res.byteSize },
              'DesignCache: lazily encoded .schem companion for legacy JSON entry',
            );
          },
          (err) => {
            const reasons = err instanceof SchematicEncodeError ? err.reasons : [err?.message ?? String(err)];
            logger.warn(
              { townId: input.townId, kind: input.kind, reasons },
              'DesignCache: lazy .schem re-encode failed; keeping JSON-only entry',
            );
          },
        );
      }
      return {
        filePath,
        filename,
        plan,
        hash,
        schemPath: schemExists ? schemPath : null,
        schemFilename: schemExists ? schemFilename : null,
      };
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
   *
   * Followup #44: also encode the plan into a Sponge v2 `.schem` companion
   * file alongside the JSON so BuildCoordinator can swing it. Encoder
   * failures degrade gracefully — the JSON cache write is the source of
   * truth, and we just leave `schemPath` null so the caller falls back to
   * the library matcher (current behaviour).
   *
   * Async because the .schem encode does a gzip pass; the JSON write itself
   * is still sync (atomic tmp + rename) so it remains crash-safe.
   */
  async save(input: DesignCacheInput, plan: BlockPlan): Promise<DesignCacheEntry | null> {
    const hash = hashStyleInput(input.styleHashInput);
    const filename = this.fileNameFor(input.kind, hash);
    const filePath = path.join(this.townDir(input.townId), filename);
    try {
      atomicWriteJsonSync(filePath, plan);
    } catch (err: any) {
      logger.warn(
        { err: err?.message, filePath },
        'DesignCache: failed to write cached plan',
      );
      return null;
    }

    // Encode the .schem companion. Failures keep the JSON entry around so
    // legacy callers + the lazy-encode path in get() can retry later.
    const schemFilename = this.schemFileNameFor(input.kind, hash);
    let schemPath: string | null = null;
    try {
      const res = await encodeAndSave(plan, {
        rootDir: this.rootDir,
        townId: input.townId,
        filename: schemFilename,
      });
      schemPath = res.filePath;
      logger.info(
        { townId: input.townId, kind: input.kind, schem: schemFilename, bytes: res.byteSize, jsonBlocks: plan.blocks.length },
        'DesignCache: encoded .schem companion alongside JSON cache',
      );
    } catch (err: any) {
      const reasons = err instanceof SchematicEncodeError ? err.reasons : [err?.message ?? String(err)];
      logger.warn(
        { townId: input.townId, kind: input.kind, reasons },
        'DesignCache: .schem encode failed; keeping JSON-only entry',
      );
    }

    return {
      filePath,
      filename,
      plan,
      hash,
      schemPath,
      schemFilename: schemPath ? schemFilename : null,
    };
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
