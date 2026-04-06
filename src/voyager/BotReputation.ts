import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';

export interface ReputationEvent {
  botName: string;
  type:
    | 'task_completed'
    | 'task_failed'
    | 'task_abandoned'
    | 'trade_honored'
    | 'trade_broken'
    | 'help_given'
    | 'help_refused'
    | 'promise_kept'
    | 'promise_broken';
  description: string;
  timestamp: number;
  impact: number; // -1 to 1
}

export interface BotReputationScore {
  botName: string;
  overall: number; // 0-100
  reliability: number; // task completion rate
  cooperation: number; // help/trade follow-through
  competence: number; // task success vs failure rate
  recentTrend: 'improving' | 'stable' | 'declining';
  totalEvents: number;
  lastUpdated: number;
}

interface PersistedData {
  events: ReputationEvent[];
}

const DEFAULT_IMPACTS: Record<ReputationEvent['type'], number> = {
  task_completed: 0.5,
  task_failed: -0.3,
  task_abandoned: -0.7,
  trade_honored: 0.4,
  trade_broken: -0.8,
  help_given: 0.3,
  help_refused: -0.2,
  promise_kept: 0.3,
  promise_broken: -0.6,
};

const DECAY_HALF_LIFE_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEBOUNCE_MS = 2000;

export class BotReputation {
  private events: ReputationEvent[] = [];
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'bot_reputation.json');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.load();
  }

  recordEvent(event: ReputationEvent): void {
    // Apply default impact if the caller left it at 0 or didn't set it meaningfully
    if (event.impact === undefined || event.impact === null) {
      event.impact = DEFAULT_IMPACTS[event.type] ?? 0;
    }
    // Clamp impact to [-1, 1]
    event.impact = Math.max(-1, Math.min(1, event.impact));
    if (!event.timestamp) {
      event.timestamp = Date.now();
    }
    this.events.push(event);
    logger.info(`[Reputation] ${event.botName}: ${event.type} (impact ${event.impact.toFixed(2)}) - ${event.description}`);
    this.scheduleSave();
  }

  getReputation(botName: string): BotReputationScore {
    const botEvents = this.events.filter((e) => e.botName === botName);
    const now = Date.now();

    const reliability = this.calcReliability(botEvents, now);
    const cooperation = this.calcCooperation(botEvents, now);
    const competence = this.calcCompetence(botEvents, now);
    const overall = reliability * 0.4 + cooperation * 0.3 + competence * 0.3;
    const recentTrend = this.calcTrend(botEvents);

    return {
      botName,
      overall: Math.round(overall * 100) / 100,
      reliability: Math.round(reliability * 100) / 100,
      cooperation: Math.round(cooperation * 100) / 100,
      competence: Math.round(competence * 100) / 100,
      recentTrend,
      totalEvents: botEvents.length,
      lastUpdated: botEvents.length > 0 ? botEvents[botEvents.length - 1].timestamp : 0,
    };
  }

  getAllReputations(): BotReputationScore[] {
    const botNames = [...new Set(this.events.map((e) => e.botName))];
    return botNames
      .map((name) => this.getReputation(name))
      .sort((a, b) => b.overall - a.overall);
  }

  getMostReliable(count = 5): BotReputationScore[] {
    const botNames = [...new Set(this.events.map((e) => e.botName))];
    return botNames
      .map((name) => this.getReputation(name))
      .sort((a, b) => b.reliability - a.reliability)
      .slice(0, count);
  }

  getMostCooperative(count = 5): BotReputationScore[] {
    const botNames = [...new Set(this.events.map((e) => e.botName))];
    return botNames
      .map((name) => this.getReputation(name))
      .sort((a, b) => b.cooperation - a.cooperation)
      .slice(0, count);
  }

  shouldTrust(botName: string, action: string): { trusted: boolean; reason: string } {
    const score = this.getReputation(botName);

    if (score.totalEvents === 0) {
      return { trusted: true, reason: 'No history — giving benefit of the doubt' };
    }

    const actionLower = action.toLowerCase();

    if (actionLower.includes('critical') || actionLower.includes('important')) {
      if (score.overall < 60) {
        return { trusted: false, reason: `Overall reputation ${score.overall} is below 60 threshold for critical tasks` };
      }
      return { trusted: true, reason: `Overall reputation ${score.overall} meets critical task threshold` };
    }

    if (actionLower.includes('trade') || actionLower.includes('exchange') || actionLower.includes('deal')) {
      if (score.cooperation < 50) {
        return { trusted: false, reason: `Cooperation score ${score.cooperation} is below 50 threshold for trades` };
      }
      return { trusted: true, reason: `Cooperation score ${score.cooperation} meets trade threshold` };
    }

    // Default: task claiming
    if (score.reliability < 40) {
      return { trusted: false, reason: `Reliability score ${score.reliability} is below 40 threshold for task claiming` };
    }
    return { trusted: true, reason: `Reliability score ${score.reliability} meets task claiming threshold` };
  }

  getBotComparison(
    botA: string,
    botB: string,
  ): { botA: BotReputationScore; botB: BotReputationScore; winner: string; advantages: Record<string, string> } {
    const scoreA = this.getReputation(botA);
    const scoreB = this.getReputation(botB);
    const advantages: Record<string, string> = {};

    if (scoreA.reliability !== scoreB.reliability) {
      advantages.reliability = scoreA.reliability > scoreB.reliability ? botA : botB;
    }
    if (scoreA.cooperation !== scoreB.cooperation) {
      advantages.cooperation = scoreA.cooperation > scoreB.cooperation ? botA : botB;
    }
    if (scoreA.competence !== scoreB.competence) {
      advantages.competence = scoreA.competence > scoreB.competence ? botA : botB;
    }

    const winner = scoreA.overall >= scoreB.overall ? botA : botB;

    return { botA: scoreA, botB: scoreB, winner, advantages };
  }

  getEventHistory(botName: string, limit = 20): ReputationEvent[] {
    return this.events
      .filter((e) => e.botName === botName)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  decay(): void {
    const now = Date.now();
    const cutoff = now - DECAY_HALF_LIFE_MS * 14; // Remove events older than 14 days
    const before = this.events.length;
    this.events = this.events.filter((e) => e.timestamp > cutoff);
    const removed = before - this.events.length;
    if (removed > 0) {
      logger.info(`[Reputation] Decayed ${removed} old events`);
      this.scheduleSave();
    }
  }

  // --- Private helpers ---

  private eventWeight(event: ReputationEvent, now: number): number {
    const age = now - event.timestamp;
    // Exponential decay: half-life of 24 hours
    return Math.pow(0.5, age / DECAY_HALF_LIFE_MS);
  }

  private calcReliability(events: ReputationEvent[], now: number): number {
    const taskTypes = new Set<ReputationEvent['type']>(['task_completed', 'task_failed', 'task_abandoned']);
    const relevant = events.filter((e) => taskTypes.has(e.type));
    if (relevant.length === 0) return 50; // neutral default

    let completedWeight = 0;
    let totalWeight = 0;
    for (const e of relevant) {
      const w = this.eventWeight(e, now);
      totalWeight += w;
      if (e.type === 'task_completed') {
        completedWeight += w;
      }
    }
    return totalWeight > 0 ? (completedWeight / totalWeight) * 100 : 50;
  }

  private calcCooperation(events: ReputationEvent[], now: number): number {
    const positiveTypes = new Set<ReputationEvent['type']>(['trade_honored', 'help_given']);
    const negativeTypes = new Set<ReputationEvent['type']>(['trade_broken', 'help_refused']);
    const relevant = events.filter((e) => positiveTypes.has(e.type) || negativeTypes.has(e.type));
    if (relevant.length === 0) return 50; // neutral default

    let positiveWeight = 0;
    let totalWeight = 0;
    for (const e of relevant) {
      const w = this.eventWeight(e, now);
      totalWeight += w;
      if (positiveTypes.has(e.type)) {
        positiveWeight += w;
      }
    }
    return totalWeight > 0 ? (positiveWeight / totalWeight) * 100 : 50;
  }

  private calcCompetence(events: ReputationEvent[], now: number): number {
    const relevant = events.filter((e) => e.type === 'task_completed' || e.type === 'task_failed');
    if (relevant.length === 0) return 50; // neutral default

    let completedWeight = 0;
    let totalWeight = 0;
    for (const e of relevant) {
      const w = this.eventWeight(e, now);
      totalWeight += w;
      if (e.type === 'task_completed') {
        completedWeight += w;
      }
    }
    return totalWeight > 0 ? (completedWeight / totalWeight) * 100 : 50;
  }

  private calcTrend(events: ReputationEvent[]): 'improving' | 'stable' | 'declining' {
    if (events.length < 4) return 'stable';

    const sorted = [...events].sort((a, b) => b.timestamp - a.timestamp);
    const recent = sorted.slice(0, 10);
    const previous = sorted.slice(10, 20);

    if (previous.length === 0) return 'stable';

    const recentAvg = recent.reduce((s, e) => s + e.impact, 0) / recent.length;
    const previousAvg = previous.reduce((s, e) => s + e.impact, 0) / previous.length;
    const diff = recentAvg - previousAvg;

    if (diff > 0.1) return 'improving';
    if (diff < -0.1) return 'declining';
    return 'stable';
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const data: PersistedData = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      this.events = data.events ?? [];
    } catch (err) {
      logger.warn(`[Reputation] Failed to load ${this.filePath}: ${err}`);
      this.events = [];
    }
  }

  private persist(): void {
    const data: PersistedData = { events: this.events };
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.persist();
      this.saveTimer = null;
    }, DEBOUNCE_MS);
  }
}
