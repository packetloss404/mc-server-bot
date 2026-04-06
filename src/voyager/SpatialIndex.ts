import { WorldMemoryRecord } from './WorldMemory';

export interface SpatialCell {
  chunkX: number;
  chunkZ: number;
  records: WorldMemoryRecord[];
  lastVisited: number;
  explorationScore: number; // 0-1
}

function toChunk(coord: number): number {
  return Math.floor(coord / 16);
}

function cellKey(chunkX: number, chunkZ: number): string {
  return `${chunkX},${chunkZ}`;
}

function dist2d(x1: number, z1: number, x2: number, z2: number): number {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz);
}

export class SpatialIndex {
  private cells: Map<string, SpatialCell> = new Map();
  private _size = 0;

  get size(): number {
    return this._size;
  }

  insert(record: WorldMemoryRecord): void {
    const cx = toChunk(record.x);
    const cz = toChunk(record.z);
    const key = cellKey(cx, cz);

    let cell = this.cells.get(key);
    if (!cell) {
      cell = { chunkX: cx, chunkZ: cz, records: [], lastVisited: Date.now(), explorationScore: 0 };
      this.cells.set(key, cell);
    }

    cell.records.push(record);
    cell.lastVisited = Date.now();
    this._size++;
  }

  remove(id: string): boolean {
    for (const cell of this.cells.values()) {
      const idx = cell.records.findIndex((r) => (r as any).id === id);
      if (idx !== -1) {
        cell.records.splice(idx, 1);
        this._size--;
        if (cell.records.length === 0) {
          this.cells.delete(cellKey(cell.chunkX, cell.chunkZ));
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Returns all records within `radius` blocks of the point (x, z).
   * Checks all chunks that could overlap the search circle.
   */
  queryRadius(x: number, z: number, radius: number): WorldMemoryRecord[] {
    const minCx = toChunk(x - radius);
    const maxCx = toChunk(x + radius);
    const minCz = toChunk(z - radius);
    const maxCz = toChunk(z + radius);

    const results: WorldMemoryRecord[] = [];
    const r2 = radius * radius;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cz = minCz; cz <= maxCz; cz++) {
        const cell = this.cells.get(cellKey(cx, cz));
        if (!cell) continue;
        for (const rec of cell.records) {
          const dx = rec.x - x;
          const dz = rec.z - z;
          if (dx * dx + dz * dz <= r2) {
            results.push(rec);
          }
        }
      }
    }

    return results;
  }

  queryChunk(chunkX: number, chunkZ: number): WorldMemoryRecord[] {
    const cell = this.cells.get(cellKey(chunkX, chunkZ));
    return cell ? [...cell.records] : [];
  }

  findNearest(x: number, z: number, filter?: (record: WorldMemoryRecord) => boolean): WorldMemoryRecord | null {
    let best: WorldMemoryRecord | null = null;
    let bestDist = Infinity;

    for (const cell of this.cells.values()) {
      // Quick bounding-box check: nearest point in this chunk
      const cellMinX = cell.chunkX * 16;
      const cellMinZ = cell.chunkZ * 16;
      const cellMaxX = cellMinX + 16;
      const cellMaxZ = cellMinZ + 16;
      const nearestX = Math.max(cellMinX, Math.min(x, cellMaxX));
      const nearestZ = Math.max(cellMinZ, Math.min(z, cellMaxZ));
      const chunkDist = dist2d(x, z, nearestX, nearestZ);

      // If this chunk's nearest possible point is farther than our best, skip
      if (chunkDist > bestDist) continue;

      for (const rec of cell.records) {
        if (filter && !filter(rec)) continue;
        const d = dist2d(x, z, rec.x, rec.z);
        if (d < bestDist) {
          bestDist = d;
          best = rec;
        }
      }
    }

    return best;
  }

  getAll(): WorldMemoryRecord[] {
    const all: WorldMemoryRecord[] = [];
    for (const cell of this.cells.values()) {
      all.push(...cell.records);
    }
    return all;
  }

  clear(): void {
    this.cells.clear();
    this._size = 0;
  }

  /** Bulk-load records (used when loading from disk). */
  bulkInsert(records: WorldMemoryRecord[]): void {
    for (const rec of records) {
      this.insert(rec);
    }
  }

  /**
   * Remove a specific record from a known cell.
   * Used when a record's position changes and it needs re-insertion.
   */
  removeFromCell(record: WorldMemoryRecord, oldCx: number, oldCz: number): boolean {
    const key = cellKey(oldCx, oldCz);
    const cell = this.cells.get(key);
    if (!cell) return false;
    const idx = cell.records.indexOf(record);
    if (idx === -1) return false;
    cell.records.splice(idx, 1);
    this._size--;
    if (cell.records.length === 0) {
      this.cells.delete(key);
    }
    return true;
  }

  getCell(chunkX: number, chunkZ: number): SpatialCell | undefined {
    return this.cells.get(cellKey(chunkX, chunkZ));
  }
}
