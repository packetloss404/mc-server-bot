import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';

export interface SkillUsageRecord {
  skillName: string;
  botName: string;
  personality: string;
  context: string;
  success: boolean;
  executionTimeMs: number;
  timestamp: number;
}

export interface SkillReputation {
  skillName: string;
  discoveredBy: string;
  totalUses: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgExecutionMs: number;
  personalityStats: Record<string, {
    uses: number;
    successes: number;
    failures: number;
  }>;
  lastUsed: number;
}

interface SkillVotes {
  upvotes: number;
  downvotes: number;
  voters: Record<string, boolean>; // botName -> last vote direction (true=up)
}

interface AttributionData {
  reputations: Record<string, SkillReputation>;
  votes: Record<string, SkillVotes>;
  usageHistory: SkillUsageRecord[];
}

export interface SkillRecommendation {
  use: boolean;
  reason?: string;
}

export class SkillAttribution {
  private filePath: string;
  private data: AttributionData;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'skill_attribution.json');
    this.data = { reputations: {}, votes: {}, usageHistory: [] };
    this.load();
  }

  recordUsage(record: SkillUsageRecord): void {
    this.data.usageHistory.push(record);

    let rep = this.data.reputations[record.skillName];
    if (!rep) {
      rep = {
        skillName: record.skillName,
        discoveredBy: record.botName,
        totalUses: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        avgExecutionMs: 0,
        personalityStats: {},
        lastUsed: 0,
      };
      this.data.reputations[record.skillName] = rep;
    }

    // Update totals
    rep.totalUses += 1;
    if (record.success) {
      rep.successCount += 1;
    } else {
      rep.failureCount += 1;
    }
    rep.successRate = rep.totalUses > 0 ? rep.successCount / rep.totalUses : 0;

    // Rolling average execution time
    rep.avgExecutionMs =
      rep.totalUses === 1
        ? record.executionTimeMs
        : rep.avgExecutionMs + (record.executionTimeMs - rep.avgExecutionMs) / rep.totalUses;

    rep.lastUsed = record.timestamp;

    // Personality stats
    if (!rep.personalityStats[record.personality]) {
      rep.personalityStats[record.personality] = { uses: 0, successes: 0, failures: 0 };
    }
    const ps = rep.personalityStats[record.personality];
    ps.uses += 1;
    if (record.success) {
      ps.successes += 1;
    } else {
      ps.failures += 1;
    }

    logger.debug({ skill: record.skillName, bot: record.botName, success: record.success }, 'Skill usage recorded');
    this.scheduleSave();
  }

  getReputation(skillName: string): SkillReputation | undefined {
    return this.data.reputations[skillName];
  }

  getAllReputations(): SkillReputation[] {
    return Object.values(this.data.reputations).sort((a, b) => b.successRate - a.successRate);
  }

  shouldUseSkill(skillName: string, personality: string): SkillRecommendation {
    const rep = this.data.reputations[skillName];
    if (!rep || rep.totalUses === 0) {
      return { use: true };
    }

    // Check personality-specific failure rate
    const ps = rep.personalityStats[personality];
    if (ps && ps.uses > 0) {
      const personalityFailRate = ps.failures / ps.uses;
      if (personalityFailRate > 0.5) {
        return {
          use: false,
          reason: `Personality "${personality}" has a ${(personalityFailRate * 100).toFixed(0)}% failure rate with skill "${skillName}"`,
        };
      }
    }

    // Check overall failure rate
    const overallFailRate = rep.failureCount / rep.totalUses;
    if (overallFailRate > 0.7) {
      return {
        use: false,
        reason: `Skill "${skillName}" has an overall ${(overallFailRate * 100).toFixed(0)}% failure rate`,
      };
    }

    // Check vote deprioritization
    const votes = this.data.votes[skillName];
    if (votes) {
      const netVotes = votes.upvotes - votes.downvotes;
      if (netVotes < 0) {
        return {
          use: false,
          reason: `Skill "${skillName}" has net negative votes (${netVotes})`,
        };
      }
    }

    return { use: true };
  }

  getSpecialists(skillCategory: string): Array<{ botName: string; successRate: number; uses: number }> {
    const keyword = skillCategory.toLowerCase();
    const botStats = new Map<string, { successes: number; total: number }>();

    for (const record of this.data.usageHistory) {
      const nameMatch = record.skillName.toLowerCase().includes(keyword);
      const contextMatch = record.context.toLowerCase().includes(keyword);
      if (!nameMatch && !contextMatch) continue;

      let stats = botStats.get(record.botName);
      if (!stats) {
        stats = { successes: 0, total: 0 };
        botStats.set(record.botName, stats);
      }
      stats.total += 1;
      if (record.success) stats.successes += 1;
    }

    return Array.from(botStats.entries())
      .map(([botName, stats]) => ({
        botName,
        successRate: stats.total > 0 ? stats.successes / stats.total : 0,
        uses: stats.total,
      }))
      .sort((a, b) => b.successRate - a.successRate || b.uses - a.uses);
  }

  vote(skillName: string, botName: string, upvote: boolean): void {
    if (!this.data.votes[skillName]) {
      this.data.votes[skillName] = { upvotes: 0, downvotes: 0, voters: {} };
    }
    const v = this.data.votes[skillName];
    const previousVote = v.voters[botName];

    // Undo previous vote if exists
    if (previousVote !== undefined) {
      if (previousVote) {
        v.upvotes = Math.max(0, v.upvotes - 1);
      } else {
        v.downvotes = Math.max(0, v.downvotes - 1);
      }
    }

    // Apply new vote
    if (upvote) {
      v.upvotes += 1;
    } else {
      v.downvotes += 1;
    }
    v.voters[botName] = upvote;

    logger.debug({ skill: skillName, bot: botName, upvote, net: v.upvotes - v.downvotes }, 'Skill vote recorded');
    this.scheduleSave();
  }

  getRecommendedSkills(personality: string, taskKeywords: string[]): string[] {
    const lowerKeywords = taskKeywords.map((k) => k.toLowerCase());

    const candidates: Array<{ skillName: string; score: number }> = [];

    for (const rep of Object.values(this.data.reputations)) {
      // Filter by keyword match
      const nameLower = rep.skillName.toLowerCase();
      const matched = lowerKeywords.some((kw) => nameLower.includes(kw));
      if (!matched) continue;

      // Compute personality-specific success rate, fall back to overall
      const ps = rep.personalityStats[personality];
      let score: number;
      if (ps && ps.uses > 0) {
        score = ps.successes / ps.uses;
      } else {
        score = rep.successRate;
      }

      // Penalize net-negative voted skills
      const votes = this.data.votes[rep.skillName];
      if (votes && votes.upvotes - votes.downvotes < 0) {
        score -= 0.3;
      }

      candidates.push({ skillName: rep.skillName, score });
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((c) => c.skillName);
  }

  prune(minUses: number, maxAge: number): number {
    const now = Date.now();
    let pruned = 0;

    for (const [skillName, rep] of Object.entries(this.data.reputations)) {
      const tooOld = (now - rep.lastUsed) > maxAge;
      const tooFew = rep.totalUses < minUses;
      if (tooOld || tooFew) {
        delete this.data.reputations[skillName];
        delete this.data.votes[skillName];
        pruned++;
      }
    }

    if (pruned > 0) {
      // Also clean up usage history for pruned skills
      const remaining = new Set(Object.keys(this.data.reputations));
      this.data.usageHistory = this.data.usageHistory.filter((r) => remaining.has(r.skillName));
      logger.info({ pruned }, 'Pruned skill attribution data');
      this.scheduleSave();
    }

    return pruned;
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AttributionData>;
      this.data = {
        reputations: parsed.reputations ?? {},
        votes: parsed.votes ?? {},
        usageHistory: parsed.usageHistory ?? [],
      };
      logger.info({ skills: Object.keys(this.data.reputations).length }, 'Loaded skill attribution data');
    } catch {
      logger.warn('Failed to load skill attribution data, starting fresh');
      this.data = { reputations: {}, votes: {}, usageHistory: [] };
    }
  }

  private persist(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        this.persist();
      } catch (err) {
        logger.error({ err }, 'Failed to persist skill attribution data');
      }
    }, 2000);
  }
}
