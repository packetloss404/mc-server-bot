import fs from 'fs';
import path from 'path';
import { ExecutionEvent } from './CodeExecutor';

export interface BotStats {
  mined: Record<string, number>;
  crafted: Record<string, number>;
  smelted: Record<string, number>;
  placed: Record<string, number>;
  killed: Record<string, number>;
  withdrew: Record<string, number>;
  deposited: Record<string, number>;
  deaths: number;
  interrupts: number;
  movementTimeouts: number;
  damageTaken: number;
}

export class StatsTracker {
  private filePath: string;
  private stats: Record<string, BotStats> = {};

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'stats.json');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.load();
  }

  trackExecution(botName: string, events: ExecutionEvent[]): void {
    const stats = this.ensure(botName);
    for (const event of events) {
      const data = event.data || {};
      switch (data.primitive) {
        case 'mineBlock':
          if (event.type === 'primitive_success') this.bump(stats.mined, String(data.name || 'unknown'), Number(data.count || 1));
          break;
        case 'craftItem':
          if (event.type === 'primitive_success') this.bump(stats.crafted, String(data.name || 'unknown'), Number(data.count || 1));
          break;
        case 'smeltItem':
          if (event.type === 'primitive_success') this.bump(stats.smelted, String(data.itemName || 'unknown'), Number(data.count || 1));
          break;
        case 'placeItem':
          if (event.type === 'primitive_success') this.bump(stats.placed, String(data.name || 'unknown'), 1);
          break;
        case 'killMob':
          if (event.type === 'primitive_success') this.bump(stats.killed, String(data.name || 'unknown'), 1);
          break;
        case 'withdrawItem':
          if (event.type === 'primitive_success') this.bump(stats.withdrew, String(data.itemName || 'unknown'), Number(data.count || 1));
          break;
        case 'depositItem':
          if (event.type === 'primitive_success') this.bump(stats.deposited, String(data.itemName || 'unknown'), Number(data.count || 1));
          break;
      }
      if (event.type === 'interrupt') stats.interrupts += 1;
      if (event.type === 'path_timeout') stats.movementTimeouts += 1;
    }
    this.persist();
  }

  trackDeath(botName: string): void {
    this.ensure(botName).deaths += 1;
    this.persist();
  }

  trackDamage(botName: string, delta: number): void {
    this.ensure(botName).damageTaken += Math.max(0, delta);
    this.persist();
  }

  summary(botName: string): string {
    const stats = this.ensure(botName);
    return [
      `mined=${this.short(stats.mined)}`,
      `crafted=${this.short(stats.crafted)}`,
      `smelted=${this.short(stats.smelted)}`,
      `placed=${this.short(stats.placed)}`,
      `kills=${this.short(stats.killed)}`,
      `deaths=${stats.deaths}`,
      `interrupts=${stats.interrupts}`,
      `pathTimeouts=${stats.movementTimeouts}`,
    ].join(' | ');
  }

  private ensure(botName: string): BotStats {
    if (!this.stats[botName]) {
      this.stats[botName] = {
        mined: {}, crafted: {}, smelted: {}, placed: {}, killed: {}, withdrew: {}, deposited: {},
        deaths: 0, interrupts: 0, movementTimeouts: 0, damageTaken: 0,
      };
    }
    return this.stats[botName];
  }

  private bump(bucket: Record<string, number>, name: string, amount: number): void {
    bucket[name] = (bucket[name] || 0) + amount;
  }

  private short(bucket: Record<string, number>): string {
    const entries = Object.entries(bucket).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return entries.length ? entries.map(([k, v]) => `${k}:${v}`).join(',') : 'none';
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      this.stats = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch {
      this.stats = {};
    }
  }

  private persist(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.stats, null, 2));
  }
}
