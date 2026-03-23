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

export class SkillLibrary {
  private skillsDir: string;
  private indexPath: string;
  private index: SkillEntry[] = [];
  private maxSkills: number;
  private docFreq: Map<string, number> = new Map();
  private embeddingClient: LLMClient | null;
  private allSkillCodeCache: string | null = null;

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
    const queryEmbedding = this.embeddingClient?.embed ? (await this.embeddingClient.embed([query]).catch(() => [] as number[][]))[0] : undefined;

    const scored = this.index.map((entry) => {
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
      const similarity = this.cosineSimilarity(queryVector, this.buildVector(this.buildSkillDocument(entry)));
      score += similarity * 20;
      if (queryEmbedding && entry.embedding) {
        score += this.cosineSimilarityDense(queryEmbedding, entry.embedding) * 25;
      }
      score += (entry.quality ?? 0.5) * 10;
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
    const entry = this.index.find((s) => s.name === name);
    if (!entry) return null;

    const filePath = path.join(this.skillsDir, entry.file);
    if (!fs.existsSync(filePath)) return null;

    return fs.readFileSync(filePath, 'utf-8');
  }

  /** Save a new skill to the library */
  async save(name: string, description: string, keywords: string[], code: string, quality = 0.8): Promise<boolean> {
    if (this.index.length >= this.maxSkills) {
      logger.warn({ name }, 'Skill library full, cannot save');
      return false;
    }

    // Overwrite if exists
    const existing = this.index.findIndex((s) => s.name === name);
    const fileName = name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.js';
    const filePath = path.join(this.skillsDir, fileName);

    fs.writeFileSync(filePath, code);

    const existingEntry = existing >= 0 ? this.index[existing] : undefined;
    const embedding = this.embeddingClient?.embed
      ? (await this.embeddingClient.embed([`${name} ${description} ${keywords.join(' ')}`]).catch(() => [] as number[][]))[0]
      : existingEntry?.embedding;
    const entry: SkillEntry = {
      name,
      description,
      keywords,
      file: fileName,
      quality,
      successCount: existingEntry?.successCount || 0,
      failureCount: existingEntry?.failureCount || 0,
      embedding,
    };

    if (existing >= 0) {
      this.index[existing] = entry;
    } else {
      this.index.push(entry);
    }

    this.allSkillCodeCache = null; // Invalidate cache
    this.saveIndex();
    this.rebuildIndexStats();
    logger.info({ name, keywords }, 'Skill saved to library');
    return true;
  }

  recordOutcome(name: string, success: boolean): void {
    const entry = this.index.find((s) => s.name === name);
    if (!entry) return;
    if (success) {
      entry.successCount = (entry.successCount || 0) + 1;
      entry.quality = Math.min(1, (entry.quality ?? 0.5) + 0.05);
    } else {
      entry.failureCount = (entry.failureCount || 0) + 1;
      entry.quality = Math.max(0, (entry.quality ?? 0.5) - 0.08);
    }
    this.saveIndex();
    this.rebuildIndexStats();
  }

  isHighQuality(name: string): boolean {
    const entry = this.index.find((s) => s.name === name);
    if (!entry) return false;
    return (entry.quality ?? 0.5) >= 0.6 && (entry.failureCount ?? 0) <= ((entry.successCount ?? 0) + 1);
  }

  /** Get ALL skill code concatenated (for VM injection so skills can call each other) */
  getAllSkillCode(): string {
    if (this.allSkillCodeCache !== null) return this.allSkillCodeCache;
    const parts: string[] = [];
    for (const entry of this.index) {
      const code = this.getCode(entry.name);
      if (code) parts.push(code);
    }
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
        this.index = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')).map((entry: SkillEntry) => ({
          quality: 0.7,
          successCount: 0,
          failureCount: 0,
          ...entry,
        }));
      } catch {
        this.index = [];
      }
    }
  }

  private saveIndex(): void {
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }

  private rebuildIndexStats(): void {
    this.docFreq = new Map();
    for (const entry of this.index) {
      const seen = new Set(this.tokenize(this.buildSkillDocument(entry)));
      for (const token of seen) {
        this.docFreq.set(token, (this.docFreq.get(token) || 0) + 1);
      }
    }
  }

  private buildSkillDocument(entry: SkillEntry): string {
    return `${entry.name} ${entry.description} ${entry.keywords.join(' ')}`.toLowerCase();
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
