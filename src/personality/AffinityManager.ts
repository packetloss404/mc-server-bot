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

  isHostile(botName: string, playerName: string): boolean {
    return this.get(botName, playerName) < this.config.hostileThreshold;
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
