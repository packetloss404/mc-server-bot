import fs from 'fs';
import path from 'path';
import { Config } from '../config';

interface AffinityStore {
  [botName: string]: { [playerName: string]: number };
}

interface RelationshipEvent {
  type: string;
  timestamp: number;
  detail?: string;
}

interface PersistedData {
  scores: AffinityStore;
  events: { [key: string]: RelationshipEvent[] };
}

export class AffinityManager {
  private store: AffinityStore = {};
  private events: Map<string, RelationshipEvent[]> = new Map();
  private config: Config['affinity'];
  private savePath: string;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Config['affinity'], dataDir: string) {
    this.config = config;
    this.savePath = path.join(dataDir, 'affinities.json');
    this.load();
  }

  get(botName: string, playerName: string): number {
    const bot = this.store[botName.toLowerCase()];
    if (!bot) return this.config.default;
    return bot[playerName.toLowerCase()] ?? this.config.default;
  }

  private set(botName: string, playerName: string, value: number): void {
    const key = botName.toLowerCase();
    if (!this.store[key]) this.store[key] = {};
    this.store[key][playerName.toLowerCase()] = Math.max(0, Math.min(100, value));
  }

  onPositiveChat(botName: string, playerName: string): void {
    this.set(botName, playerName, this.get(botName, playerName) + this.config.chatBonus);
    this.recordEvent(botName, playerName, 'chat', 'positive conversation');
    this.save();
  }

  onNegativeSentiment(botName: string, playerName: string): void {
    this.set(botName, playerName, this.get(botName, playerName) - this.config.negativeSentimentPenalty);
    this.recordEvent(botName, playerName, 'chat', 'negative sentiment');
    this.save();
  }

  onHit(botName: string, playerName: string): void {
    this.set(botName, playerName, this.get(botName, playerName) - this.config.hitPenalty);
    this.recordEvent(botName, playerName, 'hit', 'was hit by player');
    this.save();
  }

  onGift(botName: string, playerName: string): void {
    this.set(botName, playerName, this.get(botName, playerName) + this.config.giftBonus);
    this.recordEvent(botName, playerName, 'gift', 'received a gift');
    this.save();
  }

  // TODO: Add onCooperation(botName, playerName) handler to record 'cooperation'
  // events when bots complete shared tasks (e.g. joint builds, supply chain
  // deliveries). Should emit an EventLog entry and adjust affinity upward.
  // The getRelationshipSummary() method in the full AffinityManager already
  // references 'cooperation' event counts in its display logic.

  // TODO: Add onHelpRequest(botName, playerName) handler to record 'help_request'
  // events when a player asks a bot for assistance. Should emit an EventLog
  // entry. The getRelationshipSummary() method already references
  // 'help_request' event counts in its display logic.

  isHostile(botName: string, playerName: string): boolean {
    return this.get(botName, playerName) < this.config.hostileThreshold;
  }

  /** Get all affinity scores for a specific bot */
  getAllForBot(botName: string): Record<string, number> {
    return { ...(this.store[botName.toLowerCase()] || {}) };
  }

  /** Get the entire affinity store (all bots, all players) */
  getAll(): AffinityStore {
    const copy: AffinityStore = {};
    for (const [bot, players] of Object.entries(this.store)) {
      copy[bot] = { ...players };
    }
    return copy;
  }

  /**
   * Decay all affinities toward the default over time.
   * Call periodically (e.g. every 60s). Each call nudges scores
   * 1 point closer to the default, so hostility fades naturally.
   */
  decayTowardDefault(): void {
    let changed = false;
    for (const players of Object.values(this.store)) {
      for (const [player, score] of Object.entries(players)) {
        if (score < this.config.default) {
          players[player] = Math.min(score + 1, this.config.default);
          changed = true;
        } else if (score > this.config.default) {
          players[player] = Math.max(score - 1, this.config.default);
          changed = true;
        }
      }
    }
    if (changed) this.save();
  }

  clearBot(botName: string): void {
    const key = botName.toLowerCase();
    delete this.store[key];
    // Clear events for this bot
    for (const eventKey of this.events.keys()) {
      if (eventKey.startsWith(key + ':')) {
        this.events.delete(eventKey);
      }
    }
    this.save();
  }

  recordEvent(botName: string, playerName: string, type: string, detail?: string): void {
    const key = `${botName.toLowerCase()}:${playerName.toLowerCase()}`;
    if (!this.events.has(key)) this.events.set(key, []);
    const events = this.events.get(key)!;
    events.push({ type, timestamp: Date.now(), detail });
    // Keep last 20 per relationship
    if (events.length > 20) {
      events.splice(0, events.length - 20);
    }
  }

  getRelationshipSummary(botName: string, playerName: string): string {
    const key = `${botName.toLowerCase()}:${playerName.toLowerCase()}`;
    const events = this.events.get(key) ?? [];
    const affinity = this.get(botName, playerName);

    const counts: Record<string, number> = {};
    for (const e of events) {
      counts[e.type] = (counts[e.type] || 0) + 1;
    }

    const parts: string[] = [];
    if (counts['chat']) parts.push(`chatted ${counts['chat']} time${counts['chat'] > 1 ? 's' : ''}`);
    if (counts['hit']) parts.push(`been hit ${counts['hit']} time${counts['hit'] > 1 ? 's' : ''}`);
    if (counts['gift']) parts.push(`received ${counts['gift']} gift${counts['gift'] > 1 ? 's' : ''}`);
    // TODO: 'cooperation' events are displayed here but never emitted. Add
    // onCooperation() handler to record these when bots complete shared tasks
    // (joint builds, supply chain deliveries) and emit an EventLog entry.
    if (counts['cooperation']) parts.push(`cooperated ${counts['cooperation']} time${counts['cooperation'] > 1 ? 's' : ''}`);
    // TODO: 'help_request' events are displayed here but never emitted. Add
    // onHelpRequest() handler to record these when a player asks a bot for
    // assistance and emit an EventLog entry.
    if (counts['help_request']) parts.push(`${counts['help_request']} help request${counts['help_request'] > 1 ? 's' : ''}`);

    let tier: string;
    if (affinity >= 80) tier = 'Close friend';
    else if (affinity >= 60) tier = 'Friendly';
    else if (affinity >= 40) tier = 'Neutral';
    else if (affinity >= 20) tier = 'Wary';
    else tier = 'Hostile';

    const interaction = parts.length > 0 ? `You've ${parts.join(', ')} with them. ` : 'No recorded interactions. ';
    return `${interaction}Affinity: ${affinity} (${tier}).`;
  }

  getTopRelationships(botName: string, limit = 5): { player: string; affinity: number; summary: string }[] {
    const allForBot = this.getAllForBot(botName);
    return Object.entries(allForBot)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([player, affinity]) => ({
        player,
        affinity,
        summary: this.getRelationshipSummary(botName, player),
      }));
  }

  private save(): void {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.writeAtomic();
    }, 2000);
  }

  private writeAtomic(): void {
    const dir = path.dirname(this.savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const data: PersistedData = {
      scores: this.store,
      events: Object.fromEntries(this.events),
    };
    const tmpPath = this.savePath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
      fs.renameSync(tmpPath, this.savePath);
    } catch {
      try { fs.writeFileSync(this.savePath, JSON.stringify(data, null, 2)); } catch { /* best effort */ }
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  shutdown(): void {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
      this.writeAtomic();
    }
  }

  private load(): void {
    if (fs.existsSync(this.savePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.savePath, 'utf-8'));
        // Support both old format (flat AffinityStore) and new format (PersistedData)
        if (raw.scores) {
          this.store = raw.scores;
          if (raw.events) {
            this.events = new Map(Object.entries(raw.events));
          }
        } else {
          // Old format: the entire file is the AffinityStore
          this.store = raw;
        }
      } catch { /* start fresh */ }
    }
  }
}
