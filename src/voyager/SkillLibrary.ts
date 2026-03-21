import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';

interface SkillEntry {
  name: string;
  description: string;
  keywords: string[];
  file: string;
}

export interface SkillMatch {
  name: string;
  description: string;
  code: string;
}

export class SkillLibrary {
  private skillsDir: string;
  private indexPath: string;
  private index: SkillEntry[] = [];
  private maxSkills: number;

  constructor(skillsDir: string, maxSkills: number) {
    this.skillsDir = skillsDir;
    this.maxSkills = maxSkills;
    this.indexPath = path.join(skillsDir, 'index.json');

    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    this.loadIndex();
  }

  getSkillNames(): string[] {
    return this.index.map((s) => s.name);
  }

  getSkillCount(): number {
    return this.index.length;
  }

  /** Search for skills by keyword match with weighted scoring */
  search(query: string, limit = 5): SkillEntry[] {
    const lower = query.toLowerCase();
    const queryWords = lower.split(/\s+/).filter((w) => w.length > 2);

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

      return { entry, score };
    });

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.entry);
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
  save(name: string, description: string, keywords: string[], code: string): boolean {
    if (this.index.length >= this.maxSkills) {
      logger.warn({ name }, 'Skill library full, cannot save');
      return false;
    }

    // Overwrite if exists
    const existing = this.index.findIndex((s) => s.name === name);
    const fileName = name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.js';
    const filePath = path.join(this.skillsDir, fileName);

    fs.writeFileSync(filePath, code);

    const entry: SkillEntry = { name, description, keywords, file: fileName };

    if (existing >= 0) {
      this.index[existing] = entry;
    } else {
      this.index.push(entry);
    }

    this.saveIndex();
    logger.info({ name, keywords }, 'Skill saved to library');
    return true;
  }

  /** Get ALL skill code concatenated (for VM injection so skills can call each other) */
  getAllSkillCode(): string {
    const parts: string[] = [];
    for (const entry of this.index) {
      const code = this.getCode(entry.name);
      if (code) parts.push(code);
    }
    return parts.join('\n\n');
  }

  /** Get top-k relevant skill code for prompt context */
  getTopKSkillCode(query: string, k: number): string {
    const relevant = this.search(query, k);
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

  getBestMatch(query: string): SkillMatch | null {
    const match = this.search(query, 1)[0];
    if (!match) return null;
    const code = this.getCode(match.name);
    if (!code) return null;
    return {
      name: match.name,
      description: match.description,
      code,
    };
  }

  /** Build a summary string for the LLM of available skills */
  buildSkillSummary(query?: string): string {
    const entries = query ? this.search(query, 10) : this.index.slice(0, 20);

    if (entries.length === 0) return 'No skills in library yet.';

    return entries
      .map((e) => `- ${e.name}: ${e.description}`)
      .join('\n');
  }

  private loadIndex(): void {
    if (fs.existsSync(this.indexPath)) {
      try {
        this.index = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
      } catch {
        this.index = [];
      }
    }
  }

  private saveIndex(): void {
    fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
  }
}
