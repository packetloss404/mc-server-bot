import fs from 'fs';
import path from 'path';
import { Config } from '../config';

interface AffinityStore {
  [botName: string]: { [playerName: string]: number };
}

export class AffinityManager {
  private store: AffinityStore = {};
  private config: Config['affinity'];
  private savePath: string;

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
    this.save();
  }

  onNegativeSentiment(botName: string, playerName: string): void {
    this.set(botName, playerName, this.get(botName, playerName) - this.config.negativeSentimentPenalty);
    this.save();
  }

  onHit(botName: string, playerName: string): void {
    this.set(botName, playerName, this.get(botName, playerName) - this.config.hitPenalty);
    this.save();
  }

  onGift(botName: string, playerName: string): void {
    this.set(botName, playerName, this.get(botName, playerName) + this.config.giftBonus);
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
    // Return a deep-ish copy to prevent mutation
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
    delete this.store[botName.toLowerCase()];
    this.save();
  }

  private save(): void {
    const dir = path.dirname(this.savePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.savePath, JSON.stringify(this.store, null, 2));
  }

  private load(): void {
    if (fs.existsSync(this.savePath)) {
      try {
        this.store = JSON.parse(fs.readFileSync(this.savePath, 'utf-8'));
      } catch { /* start fresh */ }
    }
  }
}
