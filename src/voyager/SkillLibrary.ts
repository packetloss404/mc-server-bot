import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';
import { LLMClient } from '../ai/LLMClient';

interface SkillEntry {
  name: string;
  description: string;
  keywords: string[];
  file: string;
  quality?: number;
  successCount?: number;
  failureCount?: number;
  embedding?: number[];
  /** ms epoch of last quality update (recordOutcome). Used for time-decay on access. */
  lastQualityUpdate?: number;
  /** When true, the entry stays on disk but is skipped at load time. Used by
   *  migration scripts (e.g. tools/consolidate-explore-skills.js) to retire
   *  obsolete entries without deleting the source file. */
  deprecated?: boolean;
}

const QUALITY_DECAY_RATE = 0.999;
const QUALITY_DECAY_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Laplace-smoothed quality estimate.
 * Treats successes/failures as Bernoulli trials with a uniform prior:
 *   (s + 1) / (s + f + 2)
 * Gives 0.5 with zero data and converges to the empirical rate as samples grow.
 */
function computeQuality(skill: { successCount?: number; failureCount?: number }): number {
  const s = skill.successCount ?? 0;
  const f = skill.failureCount ?? 0;
  return (s + 1) / (s + f + 2);
}

export interface SkillMatch {
  name: string;
  description: string;
  code: string;
  score: number;
}

interface ScoredSkillEntry {
  entry: SkillEntry;
  score: number;
  matchedWords: number;
}

type SparseVector = Map<string, number>;

interface CachedEmbedding {
  vec: number[];
  expires: number;
}

const QUERY_EMBED_TTL_MS = 60 * 60 * 1000; // 1 hour
const QUERY_EMBED_CACHE_MAX = 512;
const CODE_CACHE_MAX = 256;
const VECTOR_CACHE_MAX = 1024;
/** Below this hit count the keyword pre-filter is discarded and we fall back
 *  to a full-corpus scan. Picked empirically: at ≥5 hits the embedding-scored
 *  shortlist still has room to surface a high-quality match. */
const KEYWORD_PREFILTER_MIN_HITS = 5;
/** Tokens shorter than this are too noisy to anchor a name/description hit
 *  (e.g. "to", "of", "go"). Matches the existing tokenize() floor. */
const KEYWORD_MIN_LEN = 3;

/**
 * Bounded LRU access on a Map. Standard "Map insertion order = recency"
 * trick: read-or-touch deletes and re-sets the key so it lands at the tail;
 * eviction simply pops from the head until size <= cap.
 *
 * Touching is necessary on every successful read; otherwise we degrade to a
 * FIFO that evicts hot entries the moment they reach the cap.
 */
function touchLRU<K, V>(cache: Map<K, V>, key: K, value: V): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
}

function evictLRU<K, V>(cache: Map<K, V>, max: number): void {
  while (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export class SkillLibrary {
  private skillsDir: string;
  private indexPath: string;
  private index: SkillEntry[] = [];
  private maxSkills: number;
  private docFreq: Map<string, number> = new Map();
  private embeddingClient: LLMClient | null;
  private allSkillCodeCache: string | null = null;
  /** Per-skill source cache. Invalidated on save() of the same name. LRU-bounded. */
  private codeCache: Map<string, string> = new Map();
  /** Per-entry TF-IDF sparse vector cache. Wiped when corpus IDF changes. LRU-bounded. */
  private vectorCache: Map<string, SparseVector> = new Map();
  /** Query-string → dense embedding cache. Tasks repeat across ticks, so this
   *  saves a network round-trip per searchWithScores call. LRU-bounded. */
  private queryEmbedCache: Map<string, CachedEmbedding> = new Map();

  constructor(skillsDir: string, maxSkills: number, embeddingClient: LLMClient | null = null) {
    this.skillsDir = skillsDir;
    this.maxSkills = maxSkills;
    this.embeddingClient = embeddingClient && embeddingClient.embed ? embeddingClient : null;
    this.indexPath = path.join(skillsDir, 'index.json');

    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    this.loadIndex();
    this.rebuildIndexStats();
    void this.refreshMissingEmbeddings();
  }

  getSkillNames(): string[] {
    return this.index.map((s) => s.name);
  }

  getSkillCount(): number {
    return this.index.length;
  }

  /** Search for skills by keyword match with weighted scoring */
  async search(query: string, limit = 5): Promise<SkillEntry[]> {
    return (await this.searchWithScores(query, limit)).map((s) => s.entry);
  }

  async searchWithScores(query: string, limit = 5): Promise<ScoredSkillEntry[]> {
    const lower = query.toLowerCase();
    const queryWords = lower.split(/\s+/).filter((w) => w.length > 2);
    const queryVector = this.buildVector(this.buildSkillDocument({
      name: 'query',
      description: query,
      keywords: queryWords,
      file: '',
    }));
    const queryEmbedding = await this.getQueryEmbedding(query);

    // Coarse keyword pre-filter: only score entries that share ≥1 token with
    // the query name/description/keywords. When the library grew past ~600
    // skills the per-call cosine-similarity loop became a serialized hot path.
    // Falling back to a full scan when the prefilter is too narrow keeps
    // semantic matches that don't share lexical tokens (the embedding pass
    // still has its chance).
    const queryTokenSet = new Set<string>();
    for (const w of queryWords) if (w.length >= KEYWORD_MIN_LEN) queryTokenSet.add(w);
    let candidates = this.index;
    if (queryTokenSet.size > 0) {
      const filtered = this.index.filter((entry) => this.entryMatchesAnyToken(entry, queryTokenSet));
      if (filtered.length >= KEYWORD_PREFILTER_MIN_HITS) {
        candidates = filtered;
      }
    }

    const scored = candidates.map((entry) => {
      let score = 0;
      const descWords = entry.description.toLowerCase().split(/\s+/);
      const nameWords = entry.name.toLowerCase().split(/[_\s-]+/);

      for (const word of queryWords) {
        // Exact keyword match (highest value)
        if (entry.keywords.some((k) => k === word)) score += 5;
        // Partial keyword match
        else if (entry.keywords.some((k) => k.includes(word) || word.includes(k))) score += 2;

        // Exact word in name
        if (nameWords.includes(word)) score += 4;
        // Substring in name
        else if (entry.name.toLowerCase().includes(word)) score += 2;

        // Exact word in description
        if (descWords.includes(word)) score += 3;
        // Substring in description
        else if (entry.description.toLowerCase().includes(word)) score += 1;
      }

      // Bonus for matching multiple query words (relevance)
      const matchedWords = queryWords.filter((w) =>
        entry.keywords.some((k) => k.includes(w) || w.includes(k)) ||
        entry.name.toLowerCase().includes(w) ||
        entry.description.toLowerCase().includes(w)
      );
      if (matchedWords.length > 1) score += matchedWords.length * 2;
      if (entry.description.toLowerCase() === lower.trim()) score += 12;
      const similarity = this.cosineSimilarity(queryVector, this.getEntryVector(entry));
      score += similarity * 20;
      if (queryEmbedding && entry.embedding) {
        score += this.cosineSimilarityDense(queryEmbedding, entry.embedding) * 25;
      }
      score += this.getQuality(entry) * 10;
      score += (entry.successCount ?? 0) * 0.5;
      score -= (entry.failureCount ?? 0) * 1.5;

      return { entry, score, matchedWords: matchedWords.length };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.matchedWords - a.matchedWords)
      .slice(0, limit);
  }

  /** Get skill code by name */
  getCode(name: string): string | null {
    const cached = this.codeCache.get(name);
    if (cached !== undefined) {
      // Touch on hit so the entry moves to the LRU tail.
      touchLRU(this.codeCache, name, cached);
      return cached;
    }

    const entry = this.index.find((s) => s.name === name);
    if (!entry) return null;

    const filePath = path.join(this.skillsDir, entry.file);
    if (!fs.existsSync(filePath)) return null;

    const code = fs.readFileSync(filePath, 'utf-8');
    touchLRU(this.codeCache, name, code);
    evictLRU(this.codeCache, CODE_CACHE_MAX);
    return code;
  }

  /** Save a new skill to the library. `quality` is ignored — computed via Laplace smoothing.
   *  Name collisions are versioned (skill_v2, _v3, ...) rather than overwriting the
   *  existing entry; blind overwrite would silently discard any history attached
   *  to the previous skill (success/failure counts, embedding, etc.). */
  async save(name: string, description: string, keywords: string[], code: string, _quality = 0.8): Promise<boolean> {
    if (this.index.length >= this.maxSkills) {
      logger.warn({ name }, 'Skill library full, cannot save');
      return false;
    }

    // Resolve collision by appending _vN. Note: we intentionally do NOT match
    // recordOutcome history across versions — a new code body deserves a fresh
    // quality estimate.
    let finalName = name;
    if (this.index.some((s) => s.name === finalName)) {
      let v = 2;
      while (this.index.some((s) => s.name === `${name}_v${v}`)) v += 1;
      finalName = `${name}_v${v}`;
      logger.warn({ originalName: name, finalName }, 'Skill name collision; versioning new entry');
    }

    const fileName = finalName.replace(/[^a-zA-Z0-9_-]/g, '_') + '.js';
    const filePath = path.join(this.skillsDir, fileName);

    fs.writeFileSync(filePath, code);

    const embedding = this.embeddingClient?.embed
      ? (await this.embeddingClient.embed([`${finalName} ${description} ${keywords.join(' ')}`]).catch(() => [] as number[][]))[0]
      : undefined;
    const entry: SkillEntry = {
      name: finalName,
      description,
      keywords,
      file: fileName,
      quality: computeQuality({ successCount: 0, failureCount: 0 }),
      successCount: 0,
      failureCount: 0,
      embedding,
      lastQualityUpdate: Date.now(),
    };

    this.index.push(entry);

    this.allSkillCodeCache = null; // Invalidate concat cache
    this.codeCache.delete(finalName); // Invalidate per-file cache for this skill
    this.saveIndex();
    this.rebuildIndexStats();
    logger.info({ name: finalName, keywords }, 'Skill saved to library');
    return true;
  }

  recordOutcome(name: string, success: boolean): void {
    const entry = this.index.find((s) => s.name === name);
    if (!entry) return;
    if (success) {
      entry.successCount = (entry.successCount || 0) + 1;
    } else {
      entry.failureCount = (entry.failureCount || 0) + 1;
    }
    entry.quality = computeQuality(entry);
    entry.lastQualityUpdate = Date.now();
    this.saveIndex();
    this.rebuildIndexStats();
  }

  /**
   * Return the decay-adjusted quality. Quality multiplies by 0.999 each access
   * when the entry hasn't been updated in over 7 days, modelling stale skills
   * gradually losing trust until something records a fresh outcome.
   */
  private getQuality(entry: SkillEntry): number {
    const base = entry.quality ?? computeQuality(entry);
    const lastUpdate = entry.lastQualityUpdate ?? 0;
    if (lastUpdate > 0 && Date.now() - lastUpdate > QUALITY_DECAY_AGE_MS) {
      const decayed = base * QUALITY_DECAY_RATE;
      entry.quality = decayed;
      return decayed;
    }
    return base;
  }

  isHighQuality(name: string): boolean {
    const entry = this.index.find((s) => s.name === name);
    if (!entry) return false;
    return this.getQuality(entry) >= 0.6 && (entry.failureCount ?? 0) <= ((entry.successCount ?? 0) + 1);
  }

  /** Get ALL skill code concatenated (for VM injection so skills can call each other) */
  getAllSkillCode(): string {
    if (this.allSkillCodeCache !== null) return this.allSkillCodeCache;
    const parts: string[] = [];
    // Iterate index directly (skip getCode's redundant index.find for each entry)
    for (const entry of this.index) {
      let code = this.codeCache.get(entry.name);
      if (code === undefined) {
        const filePath = path.join(this.skillsDir, entry.file);
        if (!fs.existsSync(filePath)) continue;
        code = fs.readFileSync(filePath, 'utf-8');
        touchLRU(this.codeCache, entry.name, code);
      } else {
        touchLRU(this.codeCache, entry.name, code);
      }
      parts.push(code);
    }
    evictLRU(this.codeCache, CODE_CACHE_MAX);
    this.allSkillCodeCache = parts.join('\n\n');
    return this.allSkillCodeCache;
  }

  /** Get top-k relevant skill code for prompt context */
  async getTopKSkillCode(query: string, k: number): Promise<string> {
    const relevant = (await this.searchWithScores(query, k))
      .filter((skill) => skill.score >= 6)
      .map((skill) => skill.entry);
    if (relevant.length === 0) return '';

    const parts: string[] = [];
    for (const skill of relevant) {
      const code = this.getCode(skill.name);
      if (code) {
        parts.push(`// Skill: ${skill.name} - ${skill.description}\n${code}`);
      }
    }
    return parts.join('\n\n');
  }

  async getBestMatch(query: string): Promise<SkillMatch | null> {
    const match = (await this.searchWithScores(query, 1))[0];
    if (!match || match.score < 16 || match.matchedWords === 0) return null;
    const code = this.getCode(match.entry.name);
    if (!code) return null;
    return {
      name: match.entry.name,
      description: match.entry.description,
      code,
      score: match.score,
    };
  }

  async getComposableMatches(query: string, limit = 3): Promise<SkillMatch[]> {
    return (await this.searchWithScores(query, limit))
      .filter((match) => match.score >= 8 && match.matchedWords > 0 && this.isHighQuality(match.entry.name))
      .map((match) => {
        const code = this.getCode(match.entry.name);
        if (!code) return null;
        return {
          name: match.entry.name,
          description: match.entry.description,
          code,
          score: match.score,
        };
      })
      .filter((match): match is SkillMatch => !!match);
  }

  /** Build a summary string for the LLM of available skills */
  async buildSkillSummary(query?: string): Promise<string> {
    const entries = query ? await this.search(query, 10) : this.index.slice(0, 20);

    if (entries.length === 0) return 'No skills in library yet.';

    return entries
      .map((e) => `- ${e.name}: ${e.description}`)
      .join('\n');
  }

  private loadIndex(): void {
    if (fs.existsSync(this.indexPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as SkillEntry[];
        // Drop deprecated entries from the active index. They remain on disk
        // in index.json (we re-read the file rather than the in-memory index
        // when persisting — see saveIndex) so a migration can be rolled back.
        // Filtering here makes them invisible to search/getCode/save and stops
        // them contributing to the TF-IDF corpus.
        const active = raw.filter((entry) => !entry.deprecated);
        const skippedCount = raw.length - active.length;
        if (skippedCount > 0) {
          logger.info({ skippedCount }, 'Skipped deprecated skill entries on load');
        }
        this.index = active.map((entry) => {
          const successCount = entry.successCount ?? 0;
          const failureCount = entry.failureCount ?? 0;
          return {
            ...entry,
            successCount,
            failureCount,
            // Recompute quality from counts so legacy 0.5/0.7 defaults get replaced
            // by the Laplace-smoothed value on first load.
            quality: computeQuality({ successCount, failureCount }),
          };
        });
      } catch {
        this.index = [];
      }
    }
  }

  private saveIndex(): void {
    // Preserve deprecated entries on disk: loadIndex() filters them out of the
    // in-memory index, so writing `this.index` alone would silently wipe them.
    // Re-read the on-disk file, keep its deprecated rows, and concatenate with
    // the active index.
    let deprecated: SkillEntry[] = [];
    if (fs.existsSync(this.indexPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as SkillEntry[];
        deprecated = raw.filter((entry) => entry.deprecated);
      } catch {
        deprecated = [];
      }
    }
    const merged = [...this.index, ...deprecated];
    fs.writeFileSync(this.indexPath, JSON.stringify(merged, null, 2));
  }

  private rebuildIndexStats(): void {
    this.docFreq = new Map();
    for (const entry of this.index) {
      const seen = new Set(this.tokenize(this.buildSkillDocument(entry)));
      for (const token of seen) {
        this.docFreq.set(token, (this.docFreq.get(token) || 0) + 1);
      }
    }
    // IDF just changed — invalidate per-entry vectors so they re-weight on next use.
    this.vectorCache.clear();
  }

  /** Get the cached TF-IDF vector for an entry, building it on first access. */
  private getEntryVector(entry: SkillEntry): SparseVector {
    let v = this.vectorCache.get(entry.name);
    if (v === undefined) {
      v = this.buildVector(this.buildSkillDocument(entry));
      touchLRU(this.vectorCache, entry.name, v);
      evictLRU(this.vectorCache, VECTOR_CACHE_MAX);
    } else {
      touchLRU(this.vectorCache, entry.name, v);
    }
    return v;
  }

  private buildSkillDocument(entry: SkillEntry): string {
    return `${entry.name} ${entry.description} ${entry.keywords.join(' ')}`.toLowerCase();
  }

  /** Cheap keyword pre-filter: does any token in `tokens` appear (case-insensitive)
   *  in the entry's name, description, or keywords? Used to shortlist candidates
   *  before the expensive embedding/TF-IDF scoring pass. */
  private entryMatchesAnyToken(entry: SkillEntry, tokens: Set<string>): boolean {
    const nameTokens = entry.name.toLowerCase().split(/[_\s-]+/);
    for (const t of nameTokens) if (tokens.has(t)) return true;
    const descLower = entry.description.toLowerCase();
    // Word-level membership is too strict for descriptions ("3x3 cobblestone
    // shelter" shouldn't lose to a query token "shelter" because of split).
    // Substring is acceptable here — the prefilter only has to be a superset
    // of the eventual scored hits.
    for (const t of tokens) if (descLower.includes(t)) return true;
    for (const k of entry.keywords) if (tokens.has(k.toLowerCase())) return true;
    return false;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2);
  }

  private buildVector(text: string): SparseVector {
    const tokens = this.tokenize(text);
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    const vector: SparseVector = new Map();
    const totalDocs = Math.max(this.index.length, 1);
    for (const [token, count] of tf.entries()) {
      const df = this.docFreq.get(token) || 0;
      const idf = Math.log((totalDocs + 1) / (df + 1)) + 1;
      vector.set(token, count * idf);
    }
    return vector;
  }

  private cosineSimilarity(a: SparseVector, b: SparseVector): number {
    if (a.size === 0 || b.size === 0) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;

    for (const value of a.values()) magA += value * value;
    for (const value of b.values()) magB += value * value;
    for (const [token, valueA] of a.entries()) {
      const valueB = b.get(token);
      if (valueB) dot += valueA * valueB;
    }

    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  private cosineSimilarityDense(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  private async getQueryEmbedding(query: string): Promise<number[] | undefined> {
    if (!this.embeddingClient?.embed) return undefined;

    const key = query.trim().toLowerCase();
    if (key.length === 0) return undefined;

    const now = Date.now();
    const hit = this.queryEmbedCache.get(key);
    if (hit && hit.expires > now) {
      // Touch on hit so the entry survives further eviction.
      touchLRU(this.queryEmbedCache, key, hit);
      return hit.vec;
    }
    if (hit) {
      // Stale entry — drop it before re-fetching so we don't keep stale TTLs around.
      this.queryEmbedCache.delete(key);
    }

    try {
      const [vec] = await this.embeddingClient.embed([query]);
      if (!vec) return undefined;

      touchLRU(this.queryEmbedCache, key, { vec, expires: now + QUERY_EMBED_TTL_MS });
      evictLRU(this.queryEmbedCache, QUERY_EMBED_CACHE_MAX);
      return vec;
    } catch {
      return undefined;
    }
  }

  private async refreshMissingEmbeddings(): Promise<void> {
    if (!this.embeddingClient?.embed) return;
    let changed = false;
    for (const entry of this.index) {
      if (entry.embedding) continue;
      try {
        entry.embedding = (await this.embeddingClient.embed([this.buildSkillDocument(entry)]))[0];
        changed = true;
      } catch {
        break;
      }
    }
    if (changed) this.saveIndex();
  }
}
