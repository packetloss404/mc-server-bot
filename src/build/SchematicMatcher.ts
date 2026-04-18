import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';

export interface SchematicMatch {
  filename: string;
  score: number;
  /** Human-readable reason this matched, useful for debugging/logging. */
  reason: string;
}

/**
 * Keyword synonym map — expands intent terms so that "house" matches a
 * schematic file named "cottage_01.schem", "home.schematic", etc.
 */
const KEYWORD_SYNONYMS: Record<string, string[]> = {
  house: ['house', 'cottage', 'home', 'cabin', 'dwelling', 'hut', 'residence', 'villa', 'mansion'],
  tower: ['tower', 'spire', 'turret', 'keep', 'watchtower'],
  wall: ['wall', 'fence', 'barrier', 'rampart'],
  farm: ['farm', 'plot', 'field', 'crop'],
  castle: ['castle', 'fortress', 'stronghold', 'keep', 'palace'],
  temple: ['temple', 'shrine', 'sanctuary', 'chapel', 'church'],
  bridge: ['bridge', 'crossing', 'viaduct'],
  tree: ['tree', 'oak', 'spruce', 'birch'],
};

/** Minimum score required for `match()` to consider a result usable. */
const MIN_SCORE = 1;

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/\.(schem|schematic)$/i, '')
    .split(/[\s_\-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function expandIntentTokens(tokens: string[]): string[] {
  const expanded = new Set<string>(tokens);
  for (const t of tokens) {
    const syns = KEYWORD_SYNONYMS[t];
    if (syns) {
      for (const s of syns) expanded.add(s);
    }
    // Also map any token that appears in a synonym list to its group bucket
    for (const [bucket, syns2] of Object.entries(KEYWORD_SYNONYMS)) {
      if (syns2.includes(t)) {
        expanded.add(bucket);
        for (const s of syns2) expanded.add(s);
      }
    }
  }
  return [...expanded];
}

export class SchematicMatcher {
  private schematicsDir: string;
  /** filename → token bag */
  private index: Map<string, Set<string>> = new Map();

  constructor(schematicsDir: string) {
    this.schematicsDir = schematicsDir;
  }

  /** Refresh the in-memory index from disk. Call on startup and after schematic uploads. */
  refresh(): void {
    this.index.clear();
    if (!fs.existsSync(this.schematicsDir)) {
      logger.warn({ dir: this.schematicsDir }, 'SchematicMatcher: directory missing');
      return;
    }
    let files: string[] = [];
    try {
      files = fs.readdirSync(this.schematicsDir)
        .filter((f) => f.endsWith('.schem') || f.endsWith('.schematic'));
    } catch (err: any) {
      logger.warn({ err: err.message, dir: this.schematicsDir }, 'SchematicMatcher: read failed');
      return;
    }
    for (const f of files) {
      const tokens = tokenize(f);
      this.index.set(f, new Set(tokens));
    }
    logger.info({ count: this.index.size }, 'SchematicMatcher indexed schematics');
  }

  /**
   * Find the best schematic for an intent like "oak house" or "tower".
   * Returns null if no schematic scores above the minimum threshold.
   */
  match(intent: string, opts?: { style?: string }): SchematicMatch | null {
    const all = this.matchAll(intent, { ...opts, limit: 1 });
    return all.length > 0 ? all[0] : null;
  }

  /** Return up to N matches above the threshold, ranked by score. */
  matchAll(intent: string, opts?: { style?: string; limit?: number }): SchematicMatch[] {
    const rawIntentTokens = tokenize(intent);
    if (rawIntentTokens.length === 0) return [];

    // If the intent contains no recognized tokens at all, return null-ish.
    const hasRecognized = rawIntentTokens.some(
      (t) => KEYWORD_SYNONYMS[t] || Object.values(KEYWORD_SYNONYMS).some((l) => l.includes(t)),
    );

    const intentTokens = new Set(expandIntentTokens(rawIntentTokens));
    const styleTokens = opts?.style ? new Set(tokenize(opts.style)) : null;
    const limit = opts?.limit ?? 5;

    const scored: SchematicMatch[] = [];
    for (const [filename, fileTokens] of this.index.entries()) {
      let intentHits = 0;
      const hitList: string[] = [];
      for (const t of intentTokens) {
        if (fileTokens.has(t)) {
          intentHits++;
          if (hitList.length < 5) hitList.push(t);
        }
      }
      let styleHits = 0;
      if (styleTokens) {
        for (const t of styleTokens) {
          if (fileTokens.has(t)) styleHits++;
        }
      }

      // If the user's intent had no recognized keyword, require a direct token hit.
      if (!hasRecognized && intentHits === 0) continue;
      if (intentHits === 0 && styleHits === 0) continue;

      // Prefer concise filenames (subtract a small penalty for very long ones).
      const lengthPenalty = Math.max(0, fileTokens.size - 4) * 0.25;
      const score = intentHits * 5 + styleHits * 3 - lengthPenalty;

      if (score < MIN_SCORE) continue;

      scored.push({
        filename,
        score,
        reason: `hits=${intentHits}${styleHits ? `+style:${styleHits}` : ''}${hitList.length ? ` on [${hitList.join(',')}]` : ''}`,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /** All known schematic filenames, lowercased without extension. */
  list(): string[] {
    return [...this.index.keys()].map((f) => f.toLowerCase().replace(/\.(schem|schematic)$/i, ''));
  }

  /** Return original filenames as stored (preserving extension/case). */
  listRaw(): string[] {
    return [...this.index.keys()];
  }
}
