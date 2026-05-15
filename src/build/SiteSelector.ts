import { logger } from '../util/logger';

/**
 * Auto-flat build site selection.
 *
 * Given a desired schematic footprint and a probe handle (a connected bot we
 * can use to read world blocks via IPC), search a spiral of candidate origins
 * around the probe's current position and pick the flattest, cleanest one.
 *
 * This replaces the old default of "place the schematic wherever the user
 * typed coordinates" — which dropped buildings into trees, off cliffs, and
 * underwater.
 */

export interface SiteCandidate {
  origin: { x: number; y: number; z: number };
  score: number;
  confidence: number;
  reasons: string[];
  /** Range of column tops in the footprint, in blocks. */
  flatnessRange: number;
  /** Counts surfaced as build-prep cost hints. */
  obstacles: { vegetation: number; logs: number; fluid: number; artificial: number };
}

export interface SiteSelectorOptions {
  /** Radius (blocks) of the first-pass spiral. Default 24. */
  radius?: number;
  /** Radius for the second-pass fallback. Default 48. */
  fallbackRadius?: number;
  /** Step between candidate origins in the spiral. Default 4. */
  step?: number;
  /** Max footprint Y range tolerated. Default 2 (small builds), 4 (>16). */
  maxYDelta?: number;
  /** Skip this many candidates if you have a budget. Default 24. */
  maxCandidates?: number;
}

/**
 * Minimal block shape we need from the probe. Matches WorkerHandle.getBlockAt
 * return value: { name: string; boundingBox?: string }.
 */
interface ProbedBlock {
  name: string;
  boundingBox?: string;
}

/** A getBlockAt(x, y, z) -> ProbedBlock | null function — typically WorkerHandle.getBlockAt. */
export type BlockProbe = (x: number, y: number, z: number) => Promise<ProbedBlock | null>;

const DEFAULT_RADIUS = 24;
const DEFAULT_FALLBACK_RADIUS = 48;
const DEFAULT_STEP = 4;
const DEFAULT_FLAT_TOL_SMALL = 2;
const DEFAULT_FLAT_TOL_LARGE = 4;
const DEFAULT_MAX_CANDIDATES = 24;

const SKY_CLEARANCE = 2;
const NEAR_FALLOFF = 12;

const VEG_PENALTY = 3;
const FLUID_PENALTY = 20;
const SPAWNER_PENALTY = 30;
const ARTIFICIAL_PENALTY = 50;
const ROOF_PENALTY = 5;

const VEG_PATTERN = /(_log|_leaves|sapling|grass$|fern|flower|vine|bush|mushroom|tulip|poppy|dandelion|orchid)/;
const FLUID_NAMES = new Set([
  'water', 'lava', 'flowing_water', 'flowing_lava',
]);
const PLAYER_BUILT_PATTERN = /planks$|bricks?$|concrete|glass|smooth_|polished_|_slab$|_stairs$|_door$|wool|carpet|fence|bookshelf/;
const LOG_PATTERN = /_log$|_wood$|^stripped_/;

function isVeg(b: ProbedBlock | null): boolean {
  return !!b && VEG_PATTERN.test(b.name);
}
function isLog(b: ProbedBlock | null): boolean {
  return !!b && LOG_PATTERN.test(b.name);
}
function isFluid(b: ProbedBlock | null): boolean {
  return !!b && FLUID_NAMES.has(b.name);
}
function isPlayerBuilt(b: ProbedBlock | null): boolean {
  return !!b && PLAYER_BUILT_PATTERN.test(b.name);
}
function isSolidGround(b: ProbedBlock | null): boolean {
  if (!b) return false;
  if (isVeg(b) || isFluid(b)) return false;
  // Most overworld solids report boundingBox = 'block'; tolerate missing field.
  return b.boundingBox === 'block' || b.boundingBox === undefined;
}

/**
 * Generate up to `count` (x, z) offsets in a square-spiral around (0, 0),
 * stepping `step` blocks at a time, bounded by `radius`.
 */
function* spiralOffsets(step: number, radius: number, count: number): Generator<{ dx: number; dz: number }> {
  yield { dx: 0, dz: 0 };
  let emitted = 1;
  // Ring by ring outward, in steps of `step`. Walk each ring's perimeter.
  for (let r = step; r <= radius && emitted < count; r += step) {
    let dx = -r, dz = -r;
    // Top edge (left -> right)
    for (; dx <= r && emitted < count; dx += step) {
      yield { dx, dz }; emitted++;
    }
    dx = r;
    // Right edge (top -> bottom). Start one below the top-right we just yielded.
    for (dz = -r + step; dz <= r && emitted < count; dz += step) {
      yield { dx, dz }; emitted++;
    }
    dz = r;
    // Bottom edge (right -> left), excluding the corner we just emitted.
    for (dx = r - step; dx >= -r && emitted < count; dx -= step) {
      yield { dx, dz }; emitted++;
    }
    dx = -r;
    // Left edge (bottom -> top), excluding both corners.
    for (dz = r - step; dz > -r && emitted < count; dz -= step) {
      yield { dx, dz }; emitted++;
    }
  }
}

/**
 * Find the topmost solid block in a column by scanning down from yStart.
 * Returns the Y of that block, or null if nothing solid found in the window.
 */
async function topSolidY(probe: BlockProbe, x: number, z: number, yStart: number, depth = 24): Promise<number | null> {
  for (let y = yStart + 8; y > yStart - depth; y--) {
    const b = await probe(x, y, z);
    if (isSolidGround(b)) return y;
  }
  return null;
}

async function evaluateCandidate(
  probe: BlockProbe,
  seedX: number,
  seedZ: number,
  size: { x: number; y: number; z: number },
  refY: number,
  refPos: { x: number; y: number; z: number },
  flatTol: number,
): Promise<SiteCandidate | null> {
  // 1. Probe column tops across the footprint.
  const tops: number[] = [];
  for (let dx = 0; dx < size.x; dx++) {
    for (let dz = 0; dz < size.z; dz++) {
      const top = await topSolidY(probe, seedX + dx, seedZ + dz, refY);
      if (top !== null) tops.push(top);
    }
  }
  if (tops.length < (size.x * size.z) / 2) return null; // mostly void/cave

  const minY = Math.min(...tops);
  const maxY = Math.max(...tops);
  const range = maxY - minY;
  if (range > flatTol) return null; // too uneven

  const originY = minY + 1; // build floor sits one above the dominant terrain Y
  const origin = { x: seedX, y: originY, z: seedZ };
  const reasons: string[] = [`flat to ${range} block(s)`];
  let penalty = 0;
  const obstacles = { vegetation: 0, logs: 0, fluid: 0, artificial: 0 };

  // 2. Inspect the footprint volume and the ground layer.
  for (let dx = 0; dx < size.x; dx++) {
    for (let dz = 0; dz < size.z; dz++) {
      // Ground layer just below the floor.
      const ground = await probe(origin.x + dx, originY - 1, origin.z + dz);
      if (isLog(ground)) { obstacles.logs++; penalty += VEG_PENALTY * 2; }
      else if (isVeg(ground)) { obstacles.vegetation++; penalty += VEG_PENALTY; }
      if (isFluid(ground)) { obstacles.fluid++; penalty += FLUID_PENALTY; }
      if (isPlayerBuilt(ground)) { obstacles.artificial++; penalty += ARTIFICIAL_PENALTY; }

      // Column inside the footprint — looking for trees / spawners / player builds.
      for (let dy = 0; dy < size.y; dy++) {
        const b = await probe(origin.x + dx, originY + dy, origin.z + dz);
        if (!b || b.name === 'air' || b.name === 'cave_air') continue;
        if (isLog(b)) { obstacles.logs++; penalty += VEG_PENALTY * 2; }
        else if (isVeg(b)) { obstacles.vegetation++; penalty += VEG_PENALTY; }
        if (isFluid(b)) { obstacles.fluid++; penalty += FLUID_PENALTY; }
        if (b.name === 'spawner' || b.name === 'monster_egg') penalty += SPAWNER_PENALTY;
        if (isPlayerBuilt(b)) { obstacles.artificial++; penalty += ARTIFICIAL_PENALTY; }
      }

      // Sky clearance — partial roofing / cave ceilings penalised.
      for (let dy = 0; dy < SKY_CLEARANCE; dy++) {
        const top = await probe(origin.x + dx, originY + size.y + dy, origin.z + dz);
        if (top && top.name !== 'air' && top.name !== 'cave_air') {
          penalty += ROOF_PENALTY;
        }
      }
    }
  }

  // 3. Bonuses.
  const dist = Math.hypot(origin.x - refPos.x, origin.z - refPos.z);
  const nearBonus = 20 * Math.exp(-dist / NEAR_FALLOFF);
  const sunlit = originY >= refPos.y - 1 ? 10 : 0;

  const score = 100 + nearBonus + sunlit - penalty;

  if (obstacles.vegetation) reasons.push(`${obstacles.vegetation} vegetation blocks`);
  if (obstacles.logs) reasons.push(`${obstacles.logs} tree logs in footprint`);
  if (obstacles.fluid) reasons.push(`${obstacles.fluid} fluid blocks`);
  if (obstacles.artificial) reasons.push(`${obstacles.artificial} suspected player blocks`);
  reasons.push(`${dist.toFixed(1)}m from probe`);
  if (sunlit) reasons.push('open to sky');

  const confidence = Math.max(0, Math.min(1, (score - 50) / 100));
  return {
    origin,
    score: Math.max(0, score),
    confidence,
    reasons,
    flatnessRange: range,
    obstacles,
  };
}

/**
 * Main entry. `refPos` is typically the probe bot's current position.
 * Returns the best candidate found, or `null` if no spot meets the flatness
 * requirement within either radius (caller should refuse to build).
 */
export async function selectBuildSite(
  probe: BlockProbe,
  refPos: { x: number; y: number; z: number },
  size: { x: number; y: number; z: number },
  options: SiteSelectorOptions = {},
): Promise<SiteCandidate | null> {
  const large = size.x > 16 || size.z > 16;
  const flatTol = options.maxYDelta ?? (large ? DEFAULT_FLAT_TOL_LARGE : DEFAULT_FLAT_TOL_SMALL);
  const step = options.step ?? DEFAULT_STEP;
  const maxCandidates = options.maxCandidates ?? (large ? 12 : DEFAULT_MAX_CANDIDATES);
  const radius1 = options.radius ?? DEFAULT_RADIUS;
  const radius2 = options.fallbackRadius ?? DEFAULT_FALLBACK_RADIUS;

  const refX = Math.floor(refPos.x);
  const refZ = Math.floor(refPos.z);
  const refY = Math.floor(refPos.y);

  for (const radius of [radius1, radius2]) {
    const scored: SiteCandidate[] = [];
    for (const { dx, dz } of spiralOffsets(step, radius, maxCandidates)) {
      const cand = await evaluateCandidate(probe, refX + dx, refZ + dz, size, refY, refPos, flatTol);
      if (cand && cand.score > 0) scored.push(cand);
    }
    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0];
      logger.info({
        origin: best.origin,
        score: Number(best.score.toFixed(1)),
        confidence: Number(best.confidence.toFixed(2)),
        reasons: best.reasons,
        radius,
        considered: scored.length,
      }, 'SiteSelector: chose site');
      return best;
    }
    logger.info({ radius, flatTol }, 'SiteSelector: no flat site at this radius, expanding');
  }

  logger.warn({ refPos, size, flatTol }, 'SiteSelector: no acceptable site found within fallback radius');
  return null;
}
