/**
 * Underground / bunker build-site preparation.
 *
 * `prepareBunkerSite` excavates a pit using server `/fill` commands so the
 * schematic can be placed below the surface with a 1-block soil cap intact.
 * `runBunkerEntry` builds a stairwell entrance from the surface down to the
 * top of the schematic after placement is complete.
 *
 * Both helpers take a `probeHandle` (worker handle) rather than a raw Bot
 * because all server interactions happen through the cross-thread IPC layer
 * (probeHandle.chat for op'd commands, probeHandle.getBlockAt for verification).
 */

import { logger } from '../util/logger';

export interface BunkerHandle {
  chat(message: string): void;
  getBlockAt(x: number, y: number, z: number): Promise<{ name: string } | null>;
}

export interface PrepareBunkerSiteResult {
  excavated: number;
  warnings: string[];
}

export interface BunkerEntryResult {
  blocksPlaced: number;
  torchesPlaced: number;
  warnings: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLiquid(name: string | undefined | null): boolean {
  if (!name) return false;
  const n = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
  return n === 'water' || n === 'lava' || n === 'flowing_water' || n === 'flowing_lava';
}

function isBedrock(name: string | undefined | null): boolean {
  if (!name) return false;
  const n = name.startsWith('minecraft:') ? name.slice('minecraft:'.length) : name;
  return n === 'bedrock';
}

/**
 * Sample 9 columns around an (x, z) origin and return the median topmost
 * solid Y. Used to pick a surface Y for bunker origin placement.
 *
 * Scans top-down from `searchTopY` to `searchBottomY` looking for the first
 * non-air block in each column.
 */
export async function sampleSurfaceY(
  probeHandle: BunkerHandle,
  centerX: number,
  centerZ: number,
  opts?: { searchTopY?: number; searchBottomY?: number },
): Promise<number | null> {
  const top = opts?.searchTopY ?? 200;
  const bottom = opts?.searchBottomY ?? -60;

  const samples: number[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const sx = centerX + dx;
      const sz = centerZ + dz;
      for (let y = top; y >= bottom; y--) {
        const wb = await probeHandle.getBlockAt(sx, y, sz);
        if (!wb) continue;
        const name = wb.name?.startsWith('minecraft:')
          ? wb.name.slice('minecraft:'.length)
          : wb.name;
        if (!name) continue;
        if (name === 'air' || name === 'cave_air' || name === 'void_air') continue;
        // Skip water/lava — we want the topmost solid, not the surface of a lake.
        if (isLiquid(name)) continue;
        samples.push(y);
        break;
      }
    }
  }

  if (samples.length === 0) return null;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

/**
 * Excavate a pit for an underground build. Issues slabbed `/fill ... air destroy`
 * commands through `probeHandle.chat`, then verifies the perimeter for bedrock
 * intrusion and nearby liquid that would flood post-excavation.
 *
 * The excavated volume is the schematic footprint expanded by 1 block on each
 * horizontal side, at the full schematic height.
 *
 * @throws Error if the pit intersects bedrock or borders water/lava within 2 blocks.
 */
export async function prepareBunkerSite(
  probeHandle: BunkerHandle,
  origin: { x: number; y: number; z: number },
  schSize: { x: number; y: number; z: number },
): Promise<PrepareBunkerSiteResult> {
  const warnings: string[] = [];

  // 1-block buffer on horizontal axes; full vertical extent of the schematic.
  const x1 = origin.x - 1;
  const x2 = origin.x + schSize.x;
  const z1 = origin.z - 1;
  const z2 = origin.z + schSize.z;
  const yBase = origin.y;
  const yTop = origin.y + schSize.y - 1;

  const area = (x2 - x1 + 1) * (z2 - z1 + 1);
  if (area <= 0) {
    return { excavated: 0, warnings };
  }

  logger.info(
    { origin, schSize, pit: { x1, x2, z1, z2, yBase, yTop } },
    'prepareBunkerSite: excavating pit',
  );

  // Issue /fill in Y-slabs so we stay under the 32768-block per-fill cap.
  const slabThickness = Math.max(1, Math.floor(32768 / Math.max(1, area)));
  let slabs = 0;
  for (let ySlabStart = yBase; ySlabStart <= yTop; ySlabStart += slabThickness) {
    const ySlabEnd = Math.min(ySlabStart + slabThickness - 1, yTop);
    const cmd = `/fill ${x1} ${ySlabStart} ${z1} ${x2} ${ySlabEnd} ${z2} air destroy`;
    try {
      probeHandle.chat(cmd);
      slabs++;
    } catch (err: any) {
      warnings.push(`fill slab failed: ${err?.message ?? err}`);
    }
    await sleep(200);
  }

  // Give the server a moment to apply the fills before probing.
  await sleep(500);

  // Bedrock check: scan the pit floor for bedrock intrusion. If we'd be
  // sitting on top of bedrock the schematic can't take its full Y extent.
  for (let bx = x1; bx <= x2; bx++) {
    for (let bz = z1; bz <= z2; bz++) {
      const below = await probeHandle.getBlockAt(bx, yBase - 1, bz);
      if (below && isBedrock(below.name)) {
        throw new Error(
          `prepareBunkerSite: bedrock intersects pit floor at (${bx}, ${yBase - 1}, ${bz}) — abandoning underground site`,
        );
      }
    }
  }

  // Flood check: within 2 blocks of the pit perimeter walls, refuse to build
  // if any cell is water or lava. We sample at every Y level of the pit on
  // the four wall planes (no need to check interior — those are now air).
  const checkColumn = async (cx: number, cz: number) => {
    for (let y = yBase; y <= yTop; y++) {
      const wb = await probeHandle.getBlockAt(cx, y, cz);
      if (wb && isLiquid(wb.name)) {
        throw new Error(
          `prepareBunkerSite: liquid ${wb.name} within 2 blocks of pit at (${cx}, ${y}, ${cz}) — would flood excavation`,
        );
      }
    }
  };

  for (let off = 1; off <= 2; off++) {
    // North & south walls
    for (let bx = x1 - off; bx <= x2 + off; bx++) {
      await checkColumn(bx, z1 - off);
      await checkColumn(bx, z2 + off);
    }
    // East & west walls (skip corners already checked above)
    for (let bz = z1 - off + 1; bz <= z2 + off - 1; bz++) {
      await checkColumn(x1 - off, bz);
      await checkColumn(x2 + off, bz);
    }
  }

  const excavated = area * (yTop - yBase + 1);
  logger.info(
    { slabs, excavated, warnings: warnings.length },
    'prepareBunkerSite: pit ready',
  );

  return { excavated, warnings };
}

/**
 * Construct the entrance to a bunker after the schematic has been placed.
 *
 * Builds a 1-wide vertical stairwell at (origin.x - 1, origin.z - 1) starting
 * at the surface (one block under `surfaceY`) and descending to `origin.y`.
 * Places a trapdoor at the surface entry, torches every 6 blocks, and caps
 * any remaining gap with dirt for camouflage.
 *
 * All placements go through `/setblock` via the probe handle.
 */
export async function runBunkerEntry(
  probeHandle: BunkerHandle,
  origin: { x: number; y: number; z: number },
  schSize: { x: number; y: number; z: number },
  surfaceY: number,
): Promise<BunkerEntryResult> {
  const warnings: string[] = [];
  const sx = origin.x - 1;
  const sz = origin.z - 1;
  const stairTopY = surfaceY - 1; // Y of the entry block (one below the surface cap).
  const stairBottomY = origin.y; // First in-bunker floor level.

  let blocksPlaced = 0;
  let torchesPlaced = 0;

  logger.info(
    { surfaceY, stairTopY, stairBottomY, sx, sz },
    'runBunkerEntry: building entrance',
  );

  if (stairTopY < stairBottomY) {
    warnings.push(`stairwell top (${stairTopY}) is below floor (${stairBottomY}); skipping entry build`);
    return { blocksPlaced, torchesPlaced, warnings };
  }

  // 1) Carve the stairwell column from stairTopY down to stairBottomY.
  //    Issue air /setblock for each cell so we leave a 1x1 vertical shaft.
  for (let y = stairTopY; y >= stairBottomY; y--) {
    probeHandle.chat(`/setblock ${sx} ${y} ${sz} minecraft:air replace`);
    await sleep(60);
  }

  // 2) Frame the shaft in stone so the walls are stable even if surrounding
  //    earth was air. Four sides at each Y.
  const wallOffsets: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (let y = stairTopY; y >= stairBottomY; y--) {
    for (const [dx, dz] of wallOffsets) {
      const wx = sx + dx;
      const wz = sz + dz;
      // Don't overwrite a schematic block. The schematic occupies
      // origin.x..origin.x+schSize.x-1 etc; sx/sz are origin.x-1/origin.z-1, so
      // (sx+1, sz) and (sx, sz+1) might fall inside the schematic. Skip those.
      const inSchematic =
        wx >= origin.x && wx < origin.x + schSize.x &&
        wz >= origin.z && wz < origin.z + schSize.z &&
        y >= origin.y && y < origin.y + schSize.y;
      if (inSchematic) continue;
      probeHandle.chat(`/setblock ${wx} ${y} ${wz} minecraft:stone keep`);
      blocksPlaced++;
      await sleep(40);
    }
  }

  // 3) Trapdoor at the surface entry — sits one block above the carved shaft top.
  probeHandle.chat(`/setblock ${sx} ${surfaceY} ${sz} minecraft:oak_trapdoor replace`);
  blocksPlaced++;
  await sleep(80);

  // 4) Torches every 6 blocks down the stairwell column (on a wall, north side).
  //    Use a wall_torch with explicit facing to ensure the torch attaches even
  //    when the shaft wall is freshly placed stone.
  for (let y = stairTopY; y >= stairBottomY; y -= 6) {
    // Place against the north wall (sz - 1 relative to shaft).
    probeHandle.chat(
      `/setblock ${sx} ${y} ${sz + 1} minecraft:wall_torch[facing=south] replace`,
    );
    torchesPlaced++;
    await sleep(80);
  }

  // 5) Cap any remaining surface gaps with dirt for camouflage. We check the
  //    columns immediately around the shaft entry and place dirt at surfaceY
  //    if they're currently air/cave_air.
  const camoOffsets: [number, number][] = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
  ];
  for (const [dx, dz] of camoOffsets) {
    const cx = sx + dx;
    const cz = sz + dz;
    try {
      const wb = await probeHandle.getBlockAt(cx, surfaceY, cz);
      const name = wb?.name?.startsWith('minecraft:')
        ? wb.name.slice('minecraft:'.length)
        : wb?.name;
      if (!name || name === 'air' || name === 'cave_air' || name === 'void_air') {
        probeHandle.chat(`/setblock ${cx} ${surfaceY} ${cz} minecraft:dirt replace`);
        blocksPlaced++;
        await sleep(40);
      }
    } catch {
      // Probe failures here are non-fatal — just skip camouflage for the column.
    }
  }

  logger.info(
    { blocksPlaced, torchesPlaced, warnings: warnings.length },
    'runBunkerEntry: entrance complete',
  );

  return { blocksPlaced, torchesPlaced, warnings };
}
