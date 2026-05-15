import { describe, it, expect } from 'vitest';
import { Vec3 } from 'vec3';
import { buildTerrainSummary, formatTerrainSummary } from '../../src/voyager/TerrainSummary';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeBlock {
  name: string;
  biome?: { name: string };
}

const AIR: FakeBlock = { name: 'air' };

/**
 * Build a mock Bot whose surroundings are described by a per-column top Y
 * map. `topY[`${dx},${dz}`]` gives the absolute Y of the topmost solid block
 * for that column. If a column is omitted, the column is solid stone up to
 * `defaultTopY`.
 *
 * `waterColumns` lists columns whose entire space above the top solid block
 * up to (botY) is water. `treeColumns` lists columns whose topmost block is
 * an oak_log instead of stone.
 */
function makeBot(opts: {
  botY?: number;
  defaultTopY?: number;
  topY?: Record<string, number>;
  waterColumns?: Set<string>;
  treeColumns?: Set<string>;
  biome?: string;
  /** Whether bot.findBlock should return a water block within 8. */
  waterFindHit?: boolean;
  /** Number of logs bot.findBlocks should report. */
  logCount?: number;
}) {
  const botY = opts.botY ?? 64;
  const defaultTopY = opts.defaultTopY ?? botY - 1;
  const topY = opts.topY ?? {};
  const waterColumns = opts.waterColumns ?? new Set<string>();
  const treeColumns = opts.treeColumns ?? new Set<string>();
  const biome = opts.biome ?? 'plains';

  return {
    entity: { position: new Vec3(0, botY, 0) },
    blockAt: (pos: any) => {
      const x = pos.x;
      const y = pos.y;
      const z = pos.z;
      const key = `${x},${z}`;
      const top = topY[key] ?? defaultTopY;
      // The block at the bot's feet is the column we read biome from.
      if (x === 0 && y === botY && z === 0) {
        return { name: 'air', biome: { name: biome } } as FakeBlock;
      }
      if (y <= top) {
        // Solid ground (or log at the very top).
        if (y === top && treeColumns.has(key)) {
          return { name: 'oak_log' } as FakeBlock;
        }
        return { name: 'stone' } as FakeBlock;
      }
      // Above ground: optionally water column.
      if (waterColumns.has(key) && y > top && y <= botY) {
        return { name: 'water' } as FakeBlock;
      }
      return AIR;
    },
    findBlock: (_query: any) => (opts.waterFindHit ? ({ name: 'water' } as any) : null),
    findBlocks: (_query: any) => {
      const n = opts.logCount ?? 0;
      const out: any[] = [];
      for (let i = 0; i < n; i++) out.push(new Vec3(i, 64, 0));
      return out;
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildTerrainSummary', () => {
  it('flat plain: yMin == yMax, slopeMax == 0', () => {
    const bot = makeBot({ botY: 64, defaultTopY: 63, biome: 'plains' });
    const s = buildTerrainSummary(bot);

    expect(s.biome).toBe('plains');
    expect(s.yMin).toBe(s.yMax);
    expect(s.slopeMax).toBe(0);
    expect(s.waterWithin8).toBe(false);
    expect(s.treeCount).toBe(0);
    // 9 rows separated by newlines.
    expect(s.ascii.split('\n')).toHaveLength(9);
    // Center marker is present.
    expect(s.ascii).toContain(' A ');
  });

  it('single tree: treeCount > 0 and tree shown in ASCII', () => {
    const bot = makeBot({
      botY: 64,
      defaultTopY: 63,
      treeColumns: new Set(['2,1']),
      logCount: 1,
      biome: 'forest',
    });
    const s = buildTerrainSummary(bot);

    expect(s.treeCount).toBeGreaterThan(0);
    expect(s.ascii).toContain(' T ');
    expect(s.biome).toBe('forest');
  });

  it('water nearby: waterWithin8 true', () => {
    const bot = makeBot({
      botY: 64,
      defaultTopY: 63,
      waterColumns: new Set(['1,0']),
      waterFindHit: true,
    });
    const s = buildTerrainSummary(bot);

    expect(s.waterWithin8).toBe(true);
    expect(s.ascii).toContain('~~~');
  });

  it('slope: slopeMax > 0 when heightmap varies', () => {
    // Half the grid is at Y=63, the other half at Y=66 — a 3-block step.
    const topY: Record<string, number> = {};
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        topY[`${dx},${dz}`] = dx >= 0 ? 66 : 63;
      }
    }
    const bot = makeBot({ botY: 64, topY });
    const s = buildTerrainSummary(bot);

    expect(s.slopeMax).toBeGreaterThan(0);
    expect(s.yMax).toBeGreaterThan(s.yMin);
  });

  it('formatTerrainSummary produces the documented header and footer', () => {
    const bot = makeBot({ botY: 64, defaultTopY: 63 });
    const s = buildTerrainSummary(bot);
    const text = formatTerrainSummary(s);

    expect(text).toMatch(/^TERRAIN: biome=/);
    expect(text).toContain('TOPDOWN (9x9, relative Y from agent):');
    expect(text).toContain("agent at center marked 'A'");
  });
});
