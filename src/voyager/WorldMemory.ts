import fs from 'fs';
import path from 'path';
import { Bot } from 'mineflayer';

export interface WorldMemoryRecord {
  kind: 'resource' | 'workstation' | 'container';
  name: string;
  x: number;
  y: number;
  z: number;
  updatedAt: number;
  contents?: string[];
}

export class WorldMemory {
  private static MAX_RECORDS = 200;
  private filePath: string;
  private records: WorldMemoryRecord[] = [];
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'world_memory.json');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.load();
  }

  remember(kind: WorldMemoryRecord['kind'], name: string, x: number, y: number, z: number, contents?: string[]): void {
    const existing = this.records.find((r) => r.kind === kind && r.name === name && distance(r, { x, y, z }) < 6);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.z = z;
      existing.updatedAt = Date.now();
      if (contents) existing.contents = contents;
    } else {
      this.records.push({ kind, name, x, y, z, updatedAt: Date.now(), contents });
    }

    // Evict oldest records if over limit
    if (this.records.length > WorldMemory.MAX_RECORDS) {
      this.records.sort((a, b) => b.updatedAt - a.updatedAt);
      this.records = this.records.slice(0, WorldMemory.MAX_RECORDS);
    }

    this.persist();
  }

  async rememberFromBot(bot: Bot): Promise<void> {
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
    const candidates = this.records.filter((r) => r.name === name && (!kind || r.kind === kind));
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  summary(): string {
    const latest = this.records
      .slice()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 10)
      .map((r) => `${r.kind}:${r.name}@${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.z)}${r.contents?.length ? `[${r.contents.join(',')}]` : ''}`);
    return latest.length ? latest.join(' | ') : 'none';
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
      this.records = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } catch {
      this.records = [];
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
    const tmpPath = this.filePath + '.tmp';
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(this.records, null, 2));
      fs.renameSync(tmpPath, this.filePath);
    } catch {
      try { fs.writeFileSync(this.filePath, JSON.stringify(this.records, null, 2)); } catch { /* best effort */ }
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

function distance(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
