import fs from 'fs';
import path from 'path';
import { Vec3 } from 'vec3';
import { logger } from '../util/logger';

export interface SchematicInfo {
  filename: string;
  size: { x: number; y: number; z: number };
  blockCount: number;
  /**
   * Optional per-block-type count map (block name → number of blocks of that
   * type in the schematic). Only populated for schematics small enough to
   * parse without estimation — large schematics (size-estimated or
   * volume > 200k) omit this since we don't iterate the full block list.
   */
  palette?: Record<string, number>;
}

export interface CachedSchematic {
  size: { x: number; y: number; z: number };
  /** Blocks in schematic-local coordinates (relative to start). */
  blocks: Array<{ rx: number; ry: number; rz: number; name: string; stateStr: string }>;
}

/**
 * Owns schematic file I/O: NBT parse, the local-coords block extraction, the
 * mtime-keyed parse cache, and directory listing/metadata. Extracted from
 * BuildCoordinator (review: god-object decomposition) — it touches no build-job
 * state, so it's a self-contained collaborator. The Minecraft version needed
 * for parsing is supplied via `versionProvider` so the store stays decoupled
 * from BotManager.
 */
export class SchematicStore {
  private cache = new Map<string, { mtimeMs: number; data: CachedSchematic }>();

  constructor(
    private readonly schematicsDir: string,
    private readonly versionProvider: () => Promise<string>,
  ) {}

  /**
   * Load a schematic, returning blocks in schematic-local coords. Result is
   * cached by filename+mtime so repeated loads of the same file skip the NBT
   * parse + triple-nested iteration.
   */
  async load(filename: string): Promise<CachedSchematic> {
    const fullPath = path.join(this.schematicsDir, filename);
    const mtimeMs = fs.statSync(fullPath).mtimeMs;
    const cached = this.cache.get(filename);
    if (cached && cached.mtimeMs === mtimeMs) return cached.data;

    const { Schematic } = require('prismarine-schematic');
    const buffer = fs.readFileSync(fullPath);
    const schematic = await Schematic.read(buffer, await this.versionProvider());
    const start = schematic.start();
    const end = schematic.end();
    const sx = start.x, sy = start.y, sz = start.z;
    const size = schematic.size;

    const blocks: CachedSchematic['blocks'] = [];
    const tempPos = new Vec3(0, 0, 0);
    for (let y = start.y; y <= end.y; y++) {
      for (let z = start.z; z <= end.z; z++) {
        for (let x = start.x; x <= end.x; x++) {
          tempPos.x = x; tempPos.y = y; tempPos.z = z;
          const block = schematic.getBlock(tempPos);
          if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
            const props = block.getProperties ? block.getProperties() : {};
            const stateStr = Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',');
            blocks.push({ rx: x - sx, ry: y - sy, rz: z - sz, name: block.name, stateStr });
          }
        }
      }
    }

    const data: CachedSchematic = { size: { x: size.x, y: size.y, z: size.z }, blocks };
    this.cache.set(filename, { mtimeMs, data });
    return data;
  }

  async listSchematics(): Promise<SchematicInfo[]> {
    if (!fs.existsSync(this.schematicsDir)) return [];

    const files = fs.readdirSync(this.schematicsDir).filter(
      (f) => f.endsWith('.schem') || f.endsWith('.schematic'),
    );

    const results: SchematicInfo[] = [];
    for (const filename of files) {
      try {
        // Skip files larger than 10MB to avoid OOM on huge schematics.
        const filePath = path.join(this.schematicsDir, filename);
        const stat = fs.statSync(filePath);
        if (stat.size > 10_000_000) {
          results.push({ filename, size: { x: 0, y: 0, z: 0 }, blockCount: 0 });
          logger.info({ filename, sizeBytes: stat.size }, 'Skipping large schematic metadata load');
          continue;
        }
        const info = await this.getSchematicInfo(filename);
        if (info) results.push(info);
      } catch (err: any) {
        logger.warn({ filename, err: err.message }, 'Failed to read schematic metadata');
        results.push({ filename, size: { x: 0, y: 0, z: 0 }, blockCount: 0 });
      }
    }
    return results;
  }

  /** Safe metadata loader — gets dimensions without holding the full schematic in memory. */
  async getSchematicInfo(filename: string): Promise<SchematicInfo | null> {
    const fullPath = path.join(this.schematicsDir, filename);
    if (!fs.existsSync(fullPath)) return null;

    // Heuristic: compressed .schem files typically have ~100:1 to ~200:1 ratio.
    // Files over 50KB compressed likely decompress to millions of voxels — skip parsing entirely.
    const fileSize = fs.statSync(fullPath).size;
    if (fileSize > 50_000) {
      logger.info({ filename, fileSize }, 'Large schematic — estimating dimensions from file size');
      const estVoxels = fileSize * 150;
      const estDim = Math.round(Math.cbrt(estVoxels));
      return { filename, size: { x: estDim, y: Math.round(estDim * 0.6), z: estDim }, blockCount: Math.round(estVoxels * 0.15) };
    }

    try {
      const cached = await this.load(filename);
      const size = cached.size;
      const volume = size.x * size.y * size.z;
      if (volume > 200_000) {
        return { filename, size, blockCount: Math.round(volume * 0.15) };
      }
      const palette: Record<string, number> = {};
      for (const b of cached.blocks) {
        palette[b.name] = (palette[b.name] ?? 0) + 1;
      }
      return { filename, size, blockCount: cached.blocks.length, palette };
    } catch (err: any) {
      logger.warn({ filename, err: err.message }, 'Failed to parse schematic');
      return { filename, size: { x: 0, y: 0, z: 0 }, blockCount: 0 };
    }
  }
}
