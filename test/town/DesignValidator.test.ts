/**
 * DesignValidator unit tests (followup #47).
 *
 * Covers the five risky surfaces of the validator:
 *   1. Bounds — blocks beyond the declared dimensions are flagged.
 *   2. Negative coords — blocks at negative x/y/z are flagged.
 *   3. Floating ratio — > 2% floaters trigger the floating-block rule.
 *   4. Torch-tag exemption — torches/banners/etc. don't need a neighbor.
 *   5. Missing blocks array — blocks must be a non-empty array.
 *
 * The validator is a pure function with no I/O — these tests construct
 * BlockPlan literals and assert on the shape of ValidationResult.
 */
import { describe, it, expect } from 'vitest';
import { validate } from '../../src/town/DesignValidator';
import type { BlockPlan, BlockPlanEntry } from '../../src/town/LlmDesigner';

/**
 * Build a fully-supported wall plan: every block on the ground (y=0) so the
 * floating-block check trivially passes. Tests that need to push specific
 * cases extend the returned blocks array.
 */
function makeFloorPlan(w: number, d: number, name = 'oak_planks'): BlockPlan {
  const blocks: BlockPlanEntry[] = [];
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      blocks.push({ x, y: 0, z, name });
    }
  }
  return {
    dimensions: { w, h: 1, d },
    kind: 'plaza',
    style: 'medieval-communal',
    blocks,
  };
}

describe('DesignValidator', () => {
  it('flags blocks outside the declared dimensions (bounds check)', () => {
    const plan = makeFloorPlan(3, 3);
    // Push one block past the +x boundary (dims.w = 3, so x=3 is OOB).
    plan.blocks.push({ x: 3, y: 0, z: 0, name: 'oak_planks' });

    const result = validate(plan);
    expect(result.ok).toBe(false);
    expect(result.reasons?.some((r) => /outside dims/i.test(r))).toBe(true);
  });

  it('flags blocks with negative coordinates', () => {
    const plan = makeFloorPlan(3, 3);
    plan.blocks.push({ x: -1, y: 0, z: 0, name: 'oak_planks' });

    const result = validate(plan);
    expect(result.ok).toBe(false);
    expect(result.reasons?.some((r) => /negative coordinates/i.test(r))).toBe(true);
  });

  it('flags excessive floating blocks (> 2% ratio)', () => {
    // Build a small foundation + 10 floating blocks each with no 6-neighbor.
    // Spread them 2 apart on x/z so they don't accidentally support each
    // other. 1 foundation + 10 unsupported floaters = ~91% floater ratio,
    // way over the 2% threshold.
    const blocks: BlockPlanEntry[] = [{ x: 0, y: 0, z: 0, name: 'oak_planks' }];
    for (let i = 0; i < 10; i++) {
      // Even spacing on x AND z so no two floaters touch each other.
      blocks.push({ x: 4 + i * 2, y: 5, z: 5 + i * 2, name: 'oak_planks' });
    }
    const plan: BlockPlan = {
      dimensions: { w: 32, h: 16, d: 32 },
      kind: 'house',
      style: 'medieval-communal',
      blocks,
    };

    const result = validate(plan);
    expect(result.ok).toBe(false);
    expect(result.reasons?.some((r) => /floating block/i.test(r))).toBe(true);
  });

  it('exempts torches and other structural-attachment blocks from the floating-block rule', () => {
    // Floor + two torches floating in the air. Torches are tagged structural,
    // so they should NOT trigger the floater rule.
    const plan = makeFloorPlan(3, 3);
    plan.dimensions.h = 5;
    plan.blocks.push({ x: 1, y: 3, z: 1, name: 'minecraft:wall_torch' });
    plan.blocks.push({ x: 2, y: 3, z: 1, name: 'lantern' });

    const result = validate(plan);
    // Either ok=true OR ok=false BUT no floating-block reason. The dims and
    // bounds checks should also pass with this plan.
    if (!result.ok) {
      expect(result.reasons?.some((r) => /floating block/i.test(r))).toBe(false);
    } else {
      expect(result.ok).toBe(true);
    }
  });

  it('rejects a plan whose blocks array is missing or empty', () => {
    // Case 1: blocks is missing entirely.
    const planMissing = {
      dimensions: { w: 3, h: 3, d: 3 },
      kind: 'house',
      style: 'medieval-communal',
    } as unknown as BlockPlan;
    const r1 = validate(planMissing);
    expect(r1.ok).toBe(false);
    expect(r1.reasons?.some((r) => /non-empty array/i.test(r))).toBe(true);

    // Case 2: blocks is an empty array.
    const planEmpty: BlockPlan = {
      dimensions: { w: 3, h: 3, d: 3 },
      kind: 'house',
      style: 'medieval-communal',
      blocks: [],
    };
    const r2 = validate(planEmpty);
    expect(r2.ok).toBe(false);
    expect(r2.reasons?.some((r) => /non-empty array/i.test(r))).toBe(true);
  });
});
