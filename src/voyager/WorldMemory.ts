import fs from 'fs';
import path from 'path';
import { Bot } from 'mineflayer';
import { SpatialIndex } from './SpatialIndex';

export interface WorldMemoryRecord {
  kind: 'resource' | 'workstation' | 'container';
  name: string;
  x: number;
  y: number;
  z: number;
  updatedAt: number;
  contents?: string[];
  /** Confidence score 0-1, decays over time based on age since updatedAt. */
  confidence?: number;
}

/** Default max age for confidence decay: 30 minutes. */
const DEFAULT_MAX_AGE_MS = 1_800_000;

/** Records below this confidence are pruned on insert. */
const PRUNE_THRESHOLD = 0.1;

function computeConfidence(record: WorldMemoryRecord, now: number, maxAgeMs: number): number {
  const age = now - record.updatedAt;
  return Math.max(0, 1 - age / maxAgeMs);
}

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class WorldMemory {
  private static MAX_RECORDS = 2000;
  private filePath: string;
  private index: SpatialIndex;
  private maxAgeMs: number;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Optional bot reference for position-aware queries. */
  private bot: Bot | null = null;

  constructor(dataDir: string, maxAgeMs: number = DEFAULT_MAX_AGE_MS) {
    this.filePath = path.join(dataDir, 'world_memory.json');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.index = new SpatialIndex();
    this.maxAgeMs = maxAgeMs;
    this.load();
  }

  /** Set a bot reference so findNearest can use spatial proximity. */
  setBot(bot: Bot): void {
    this.bot = bot;
  }

  remember(kind: WorldMemoryRecord['kind'], name: string, x: number, y: number, z: number, contents?: string[]): void {
    // Lazy prune: remove stale records before inserting
    this.pruneStale();

    const allRecords = this.index.getAll();
    const existing = allRecords.find((r) => r.kind === kind && r.name === name && distance(r, { x, y, z }) < 6);

    if (existing) {
      const oldCx = Math.floor(existing.x / 16);
      const oldCz = Math.floor(existing.z / 16);
      this.index.removeFromCell(existing, oldCx, oldCz);

      existing.x = x;
      existing.y = y;
      existing.z = z;
      existing.updatedAt = Date.now();
      existing.confidence = 1;
      if (contents) existing.contents = contents;

      this.index.insert(existing);
    } else {
      const record: WorldMemoryRecord = { kind, name, x, y, z, updatedAt: Date.now(), contents, confidence: 1 };
      this.index.insert(record);
    }

    if (this.index.size > WorldMemory.MAX_RECORDS) {
      const all = this.index.getAll();
      all.sort((a, b) => b.updatedAt - a.updatedAt);
      const keep = all.slice(0, WorldMemory.MAX_RECORDS);
      this.index.clear();
      this.index.bulkInsert(keep);
    }

    this.persist();
  }

  async rememberFromBot(bot: Bot): Promise<void> {
    this.bot = bot;

    const interestingBlocks = [
      { kind: 'workstation' as const, name: 'crafting_table' },
      { kind: 'workstation' as const, name: 'furnace' },
      { kind: 'container' as const, name: 'chest' },
      { kind: 'resource' as const, name: 'farmland' },
      { kind: 'resource' as const, name: 'water' },
      { kind: 'resource' as const, name: 'oak_log' },
      { kind: 'resource' as const, name: 'iron_ore' },
      { kind: 'resource' as const, name: 'coal_ore' },
    ];

    for (const blockInfo of interestingBlocks) {
      try {
        const block = bot.findBlock({ matching: (b: any) => b.name === blockInfo.name, maxDistance: 24 });
        if (block) {
          let contents: string[] | undefined;
          if (blockInfo.kind === 'container' && block.position.distanceTo(bot.entity.position) <= 4) {
            contents = await this.inspectContainer(bot, block).catch(() => undefined);
          }
          this.remember(blockInfo.kind, blockInfo.name, block.position.x, block.position.y, block.position.z, contents);
        }
      } catch {
        // ignore
      }
    }
  }

  findNearest(name: string, kind?: WorldMemoryRecord['kind']): WorldMemoryRecord | null {
    const botPos = this.getBotPosition();

    if (botPos) {
      return this.index.findNearest(botPos.x, botPos.z, (r) => r.name === name && (!kind || r.kind === kind));
    }

    const candidates = this.index.getAll().filter((r) => r.name === name && (!kind || r.kind === kind));
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  queryNearby(x: number, y: number, z: number, radius: number): WorldMemoryRecord[] {
    const candidates = this.index.queryRadius(x, z, radius);
    const ref = { x, y, z };
    return candidates
      .filter((r) => distance(r, ref) <= radius)
      .sort((a, b) => distance(a, ref) - distance(b, ref));
  }

  summary(): string {
    const all = this.index.getAll();
    const latest = all
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10)
      .map((r) => `${r.kind}:${r.name}@${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.z)}${r.contents?.length ? `[${r.contents.join(',')}]` : ''}`);
    return latest.length ? latest.join(' | ') : 'none';
  }

  getRecords(): WorldMemoryRecord[] {
    return this.index.getAll();
  }

  get recordCount(): number {
    return this.index.size;
  }

  private getBotPosition(): { x: number; y: number; z: number } | null {
    try {
      if (this.bot?.entity?.position) {
        const p = this.bot.entity.position;
        return { x: p.x, y: p.y, z: p.z };
      }
    } catch {
      // bot may be disconnected
    }
    return null;
  }

  private pruneStale(): void {
    const now = Date.now();
    const all = this.index.getAll();
    const stale = all.filter((r) => computeConfidence(r, now, this.maxAgeMs) < PRUNE_THRESHOLD);
    if (stale.length === 0) return;

    const keep = all.filter((r) => computeConfidence(r, now, this.maxAgeMs) >= PRUNE_THRESHOLD);
    this.index.clear();
    this.index.bulkInsert(keep);
  }

  private async inspectContainer(bot: Bot, block: any): Promise<string[]> {
    const container = await (bot as any).openContainer(block);
    try {
      const items = (container.containerItems?.() || [])
        .filter((item: any) => item)
        .map((item: any) => `${item.name}x${item.count}`)
        .slice(0, 12);
      return items;
    } finally {
      container.close();
    }
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) return;
    try {
      const data: WorldMemoryRecord[] = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      const now = Date.now();
      for (const rec of data) {
        if (rec.confidence === undefined) {
          rec.confidence = computeConfidence(rec, now, this.maxAgeMs);
        }
      }
      const valid = data.filter((r) => computeConfidence(r, now, this.maxAgeMs) >= PRUNE_THRESHOLD);
      this.index.bulkInsert(valid);
    } catch {
      // corrupted file, start fresh
    }
  }

  private persist(): void {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.writeAtomic();
    }, 2000);
  }

  private writeAtomic(): void {
    const records = this.index.getAll();
    const tmpPath = this.filePath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(records, null, 2));
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      try { fs.writeFileSync(this.filePath, JSON.stringify(records, null, 2)); } catch { /* best effort */ }
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
}

export { SpatialIndex } from './SpatialIndex';
