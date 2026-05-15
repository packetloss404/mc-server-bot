import { Bot } from 'mineflayer';

export interface TerrainSummary {
  biome: string;
  yMedian: number;
  yMin: number;
  yMax: number;
  slopeMax: number;
  waterWithin8: boolean;
  treeCount: number;
  /** Multiline ASCII top-down 9x9 heightmap, agent at center. */
  ascii: string;
}

interface CellInfo {
  /** Relative Y from the agent (topmost solid found). */
  relY: number;
  /** True if any water column is present in the (dx, dz) stack we scanned. */
  water: boolean;
  /** True if the topmost solid block is a log (tree). */
  tree: boolean;
  /** True if no solid block was found in the scan window. */
  unknown: boolean;
}

function pad3(value: number): string {
  // Format an integer Y offset as a 3-char cell. Positive numbers are printed
  // without a sign so they line up with negatives at the same width.
  const clamped = Math.max(-99, Math.min(99, Math.trunc(value)));
  if (clamped === 0) return '  0';
  if (clamped > 0) {
    return clamped < 10 ? ` +${clamped}` : `+${clamped}`;
  }
  // clamped is negative; "-N" already has a sign
  return clamped > -10 ? ` ${clamped}` : `${clamped}`;
}

function isLogName(name: string): boolean {
  return /_log$/.test(name) || /_wood$/.test(name);
}

function isWaterName(name: string): boolean {
  return name === 'water' || name === 'flowing_water';
}

function isSolidForHeight(name: string): boolean {
  // We're looking for the topmost ground-like surface. Skip air, water, and
  // foliage (leaves) — but logs DO count and get rendered as 'T'.
  if (!name || name === 'air' || name === 'cave_air' || name === 'void_air') return false;
  if (isWaterName(name)) return false;
  if (name === 'lava' || name === 'flowing_lava') return false;
  if (/_leaves$/.test(name)) return false;
  return true;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

export function buildTerrainSummary(bot: Bot, radius: number = 4): TerrainSummary {
  const r = Math.max(1, Math.trunc(radius));
  const size = r * 2 + 1;

  const pos = bot.entity?.position;
  if (!pos) {
    return {
      biome: 'unknown',
      yMedian: 0,
      yMin: 0,
      yMax: 0,
      slopeMax: 0,
      waterWithin8: false,
      treeCount: 0,
      ascii: '',
    };
  }

  const ox = Math.floor(pos.x);
  const oy = Math.floor(pos.y);
  const oz = Math.floor(pos.z);

  // Build a 2D grid of cells in row-major order: grid[row][col].
  // row corresponds to dz from -r..+r (north to south), col to dx from -r..+r.
  const grid: CellInfo[][] = [];
  const heights: number[] = [];

  for (let row = 0; row < size; row++) {
    const dz = row - r;
    const rowCells: CellInfo[] = [];
    for (let col = 0; col < size; col++) {
      const dx = col - r;
      let topY: number | null = null;
      let topName = '';
      let waterTopY: number | null = null;

      const startY = oy + 8;
      const stopY = oy - 8; // scan a 16-block vertical window to find the topmost surface

      for (let y = startY; y >= stopY; y--) {
        let block: { name?: string } | null = null;
        try {
          block = bot.blockAt({ x: ox + dx, y, z: oz + dz } as any) as any;
        } catch {
          block = null;
        }
        const name = block?.name ?? '';
        if (isWaterName(name)) {
          if (waterTopY === null) waterTopY = y;
          continue;
        }
        if (isSolidForHeight(name)) {
          topY = y;
          topName = name;
          break;
        }
      }

      // A column counts as "water" when water was seen above any solid block —
      // i.e. the visible surface from above is water.
      const isWaterCell = waterTopY !== null;

      if (topY === null && !isWaterCell) {
        rowCells.push({ relY: 0, water: false, tree: false, unknown: true });
      } else {
        const surfaceY = isWaterCell ? (waterTopY as number) : (topY as number);
        const relY = surfaceY - oy;
        heights.push(relY);
        rowCells.push({
          relY,
          water: isWaterCell,
          tree: !isWaterCell && isLogName(topName),
          unknown: false,
        });
      }
    }
    grid.push(rowCells);
  }

  // Biome from the block at the agent's feet.
  let biome = 'unknown';
  try {
    const here = bot.blockAt({ x: ox, y: oy, z: oz } as any) as any;
    const name = here?.biome?.name;
    if (typeof name === 'string' && name) biome = name;
  } catch {
    biome = 'unknown';
  }

  // Mark the center cell (agent).
  const centerRow = r;
  const centerCol = r;

  // Compute yMin, yMax, yMedian from non-unknown cells.
  const yMin = heights.length > 0 ? Math.min(...heights) : 0;
  const yMax = heights.length > 0 ? Math.max(...heights) : 0;
  const yMedian = median(heights);

  // slopeMax: max absolute diff between any two 4-connected cells (both known).
  let slopeMax = 0;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const cell = grid[row][col];
      if (cell.unknown) continue;
      if (col + 1 < size) {
        const right = grid[row][col + 1];
        if (!right.unknown) {
          const diff = Math.abs(cell.relY - right.relY);
          if (diff > slopeMax) slopeMax = diff;
        }
      }
      if (row + 1 < size) {
        const down = grid[row + 1][col];
        if (!down.unknown) {
          const diff = Math.abs(cell.relY - down.relY);
          if (diff > slopeMax) slopeMax = diff;
        }
      }
    }
  }

  // waterWithin8: prefer bot.findBlock, fall back to grid-derived water flag.
  let waterWithin8 = false;
  try {
    const found = (bot as any).findBlock?.({
      matching: (b: any) => isWaterName(b?.name ?? ''),
      maxDistance: 8,
    });
    waterWithin8 = !!found;
  } catch {
    waterWithin8 = false;
  }
  if (!waterWithin8) {
    for (const r0 of grid) for (const c of r0) if (c.water) { waterWithin8 = true; break; }
  }

  // treeCount via findBlocks.
  let treeCount = 0;
  try {
    const logs = (bot as any).findBlocks?.({
      matching: (b: any) => isLogName(b?.name ?? ''),
      maxDistance: 12,
      count: 16,
    });
    treeCount = Array.isArray(logs) ? logs.length : 0;
  } catch {
    treeCount = 0;
  }

  // Render ASCII (3-char cells).
  const rows: string[] = [];
  for (let row = 0; row < size; row++) {
    const parts: string[] = [];
    for (let col = 0; col < size; col++) {
      if (row === centerRow && col === centerCol) {
        parts.push(' A ');
        continue;
      }
      const cell = grid[row][col];
      if (cell.unknown) {
        parts.push(' ? ');
        continue;
      }
      if (cell.tree) {
        parts.push(' T ');
        continue;
      }
      if (cell.water) {
        parts.push('~~~');
        continue;
      }
      parts.push(pad3(cell.relY));
    }
    rows.push(parts.join(' '));
  }

  return {
    biome,
    yMedian,
    yMin,
    yMax,
    slopeMax,
    waterWithin8,
    treeCount,
    ascii: rows.join('\n'),
  };
}

export function formatTerrainSummary(s: TerrainSummary): string {
  return `TERRAIN: biome=${s.biome}, Y_median=${s.yMedian}, slope_max=${s.slopeMax}, water<8m=${s.waterWithin8 ? 'yes' : 'no'}, trees=${s.treeCount}
TOPDOWN (9x9, relative Y from agent):
${s.ascii}
NOTES: agent at center marked 'A'. Negative = lower. '~~~' = water, ' T ' = tree.`;
}
