/**
 * DesignValidator — Phase 4 sanity check for LLM-generated block plans.
 *
 * The LLM returns a JSON block plan we can't blindly trust; this validator
 * gives the LlmDesigner an objective gate before we cache the plan or hand it
 * to BuildCoordinator. The three current checks are:
 *
 *   1. Footprint fits within the declared dimensions (no blocks beyond w/h/d).
 *   2. No negative coordinates — block plans live in local 0..(dim-1) space.
 *   3. No excessive floating blocks — every non-foundation block needs at least
 *      one neighbor block, the ground (y == 0), or a structural support tag.
 *
 * On failure we return human-readable reasons so the designer's retry loop
 * can include them in the next prompt (best-effort self-correction).
 */
import type { BlockPlan, BlockPlanEntry } from './LlmDesigner';

export interface ValidationResult {
  ok: boolean;
  reasons?: string[];
}

/** Up to this many floating-block reports before we collapse them into a count. */
const MAX_REPORTED_FLOATERS = 5;

/**
 * Some blocks are explicitly OK to "float" — torches, banners, doors, signs
 * etc. attach to neighbors but we don't want a strict 6-neighbor check
 * flagging them when the neighbor exists in the same plan.
 */
const STRUCTURAL_TAGS = new Set([
  'torch',
  'wall_torch',
  'lantern',
  'sign',
  'banner',
  'ladder',
  'vine',
  'door',
  'trapdoor',
  'button',
  'lever',
  'rail',
  'painting',
  'item_frame',
  'glow_lichen',
]);

function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function isStructuralAttachment(name: string): boolean {
  const lc = name.toLowerCase().replace(/^minecraft:/, '');
  for (const tag of STRUCTURAL_TAGS) {
    if (lc.includes(tag)) return true;
  }
  return false;
}

export function validate(plan: BlockPlan): ValidationResult {
  const reasons: string[] = [];

  if (!plan || typeof plan !== 'object') {
    return { ok: false, reasons: ['plan is missing or not an object'] };
  }

  const dims = plan.dimensions;
  if (
    !dims ||
    typeof dims.w !== 'number' ||
    typeof dims.h !== 'number' ||
    typeof dims.d !== 'number' ||
    dims.w <= 0 ||
    dims.h <= 0 ||
    dims.d <= 0
  ) {
    return { ok: false, reasons: ['plan.dimensions must be {w,h,d} with positive integers'] };
  }

  if (!Array.isArray(plan.blocks) || plan.blocks.length === 0) {
    return { ok: false, reasons: ['plan.blocks must be a non-empty array'] };
  }

  // Pass 1: bounds + negative coords + index the occupancy map.
  const occupancy = new Set<string>();
  let outOfBounds = 0;
  let negativeCoords = 0;
  for (const b of plan.blocks) {
    if (
      !b ||
      typeof b.x !== 'number' ||
      typeof b.y !== 'number' ||
      typeof b.z !== 'number' ||
      typeof b.name !== 'string' ||
      b.name.length === 0
    ) {
      reasons.push('every block must have numeric x/y/z and a non-empty name');
      // Don't bother continuing — every later check assumes well-typed entries.
      return { ok: false, reasons };
    }
    if (b.x < 0 || b.y < 0 || b.z < 0) negativeCoords++;
    if (b.x >= dims.w || b.y >= dims.h || b.z >= dims.d) outOfBounds++;
    occupancy.add(blockKey(b.x, b.y, b.z));
  }
  if (negativeCoords > 0) {
    reasons.push(`${negativeCoords} block(s) had negative coordinates`);
  }
  if (outOfBounds > 0) {
    reasons.push(`${outOfBounds} block(s) fall outside dims ${dims.w}x${dims.h}x${dims.d}`);
  }

  // Pass 2: floating-block check. A block is "supported" when ANY of:
  //   - y === 0 (sits on the ground / foundation)
  //   - any 6-neighbor exists in the plan
  //   - its name matches a structural-attachment tag (torch, sign, etc.)
  const floaters: BlockPlanEntry[] = [];
  for (const b of plan.blocks) {
    if (b.y === 0) continue;
    if (isStructuralAttachment(b.name)) continue;
    const hasNeighbor =
      occupancy.has(blockKey(b.x - 1, b.y, b.z)) ||
      occupancy.has(blockKey(b.x + 1, b.y, b.z)) ||
      occupancy.has(blockKey(b.x, b.y - 1, b.z)) ||
      occupancy.has(blockKey(b.x, b.y + 1, b.z)) ||
      occupancy.has(blockKey(b.x, b.y, b.z - 1)) ||
      occupancy.has(blockKey(b.x, b.y, b.z + 1));
    if (!hasNeighbor) floaters.push(b);
  }
  if (floaters.length > 0) {
    // Allow a tiny number of "decoration" floaters (lanterns hung from a
    // neighbor block we forgot to include); flag anything substantial. The
    // 2% threshold catches obvious LLM hallucinations without nuking
    // otherwise-good plans.
    const ratio = floaters.length / plan.blocks.length;
    const overLimit = floaters.length > 3 || ratio > 0.02;
    if (overLimit) {
      const sample = floaters
        .slice(0, MAX_REPORTED_FLOATERS)
        .map((b) => `${b.name}@(${b.x},${b.y},${b.z})`)
        .join(', ');
      const suffix = floaters.length > MAX_REPORTED_FLOATERS ? ` (+${floaters.length - MAX_REPORTED_FLOATERS} more)` : '';
      reasons.push(`${floaters.length} floating block(s) without support: ${sample}${suffix}`);
    }
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
