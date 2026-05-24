/**
 * CivilizationMetrics unit tests (Project Sid P1-B).
 *
 * Exercises the PURE math layer behind `GET /api/metrics/civilization` — no
 * file I/O. Each test pins one of the spec properties from the roadmap:
 *   - role-distribution entropy (Fig-8E): uniform 4-role = 2 bits, single = 0;
 *   - action-exclusivity index (Fig-9): 1 when each action is owned by one bot,
 *     lower when actions are shared;
 *   - unique items (Fig-5): dedupes across bots/buckets, sums quantities.
 */
import { describe, it, expect } from 'vitest';
import {
  shannonEntropy,
  actionExclusivity,
  uniqueItems,
  roleHistogram,
  buildActionMatrix,
  computeCivilizationMetrics,
} from '../../src/town/CivilizationMetrics';
import type { BotActionStats } from '../../src/town/ObservedRoleModel';

describe('shannonEntropy', () => {
  it('is 2 bits for a uniform 4-role distribution', () => {
    expect(shannonEntropy([1, 1, 1, 1])).toBeCloseTo(2, 10);
    // Scale-invariant: only proportions matter.
    expect(shannonEntropy([5, 5, 5, 5])).toBeCloseTo(2, 10);
  });

  it('is 1 bit for a uniform 2-category distribution', () => {
    expect(shannonEntropy([3, 3])).toBeCloseTo(1, 10);
  });

  it('is 0 for a single-role distribution', () => {
    expect(shannonEntropy([7])).toBe(0);
    expect(shannonEntropy([0, 9, 0])).toBe(0);
  });

  it('is 0 for an empty or all-zero input', () => {
    expect(shannonEntropy([])).toBe(0);
    expect(shannonEntropy([0, 0, 0])).toBe(0);
  });

  it('ignores zero-count categories (0·log0 ≡ 0)', () => {
    // Three real categories evenly split → log2(3) bits, extra zeros don't move it.
    expect(shannonEntropy([2, 2, 2, 0, 0])).toBeCloseTo(Math.log2(3), 10);
  });

  it('skews below max when the distribution is uneven', () => {
    const even = shannonEntropy([1, 1, 1, 1]); // 2.0
    const skewed = shannonEntropy([7, 1, 1, 1]);
    expect(skewed).toBeLessThan(even);
    expect(skewed).toBeGreaterThan(0);
  });
});

describe('actionExclusivity', () => {
  it('is 1 when each action is performed by exactly one bot', () => {
    const matrix = {
      mined: { Alice: 100 },
      crafted: { Bob: 50 },
      placed: { Carol: 30 },
    };
    expect(actionExclusivity(matrix)).toBe(1);
  });

  it('is lower when an action is shared across bots', () => {
    const exclusive = actionExclusivity({ mined: { Alice: 100 } });
    const shared = actionExclusivity({ mined: { Alice: 50, Bob: 50 } });
    expect(shared).toBe(0.5); // max-share 50/100
    expect(shared).toBeLessThan(exclusive);
  });

  it('averages max-shares across action types', () => {
    // mined: fully exclusive (share 1). crafted: even 2-way split (share 0.5).
    // mean = 0.75.
    const matrix = {
      mined: { Alice: 80 },
      crafted: { Alice: 10, Bob: 10 },
    };
    expect(actionExclusivity(matrix)).toBeCloseTo(0.75, 10);
  });

  it('skips action types nobody performs', () => {
    const matrix = {
      mined: { Alice: 40, Bob: 40 }, // share 0.5
      killed: {}, // no activity → skipped, must not drag toward 0
    };
    expect(actionExclusivity(matrix)).toBe(0.5);
  });

  it('is 0 when there is no activity at all', () => {
    expect(actionExclusivity({})).toBe(0);
    expect(actionExclusivity({ mined: {}, crafted: {} })).toBe(0);
  });
});

describe('uniqueItems', () => {
  it('dedupes distinct items across bots and buckets', () => {
    const stats: BotActionStats[] = [
      { mined: { oak_log: 10, stone: 5 }, crafted: { oak_planks: 4 } },
      // oak_log repeats (already counted); iron_ore is new; oak_planks repeats.
      { mined: { oak_log: 3, iron_ore: 2 }, crafted: { oak_planks: 1, stick: 8 } },
    ];
    const result = uniqueItems(stats);
    // distinct ids: oak_log, stone, oak_planks, iron_ore, stick = 5
    expect(result.distinct).toBe(5);
    expect(result.items).toEqual(['iron_ore', 'oak_log', 'oak_planks', 'stick', 'stone']);
    // cumulative total: 10+5+4 + 3+2+1+8 = 33
    expect(result.total).toBe(33);
  });

  it('ignores smelted/placed/killed buckets (mined+crafted only)', () => {
    const stats: BotActionStats[] = [
      { mined: { coal: 4 }, smelted: { raw_iron: 9 }, placed: { dirt: 12 }, killed: { zombie: 3 } },
    ];
    const result = uniqueItems(stats);
    expect(result.distinct).toBe(1); // only coal
    expect(result.total).toBe(4);
  });

  it('returns empty for empty input', () => {
    expect(uniqueItems([])).toEqual({ distinct: 0, total: 0, items: [] });
    expect(uniqueItems([{}])).toEqual({ distinct: 0, total: 0, items: [] });
  });

  it('skips non-positive counts', () => {
    const result = uniqueItems([{ mined: { oak_log: 0, stone: 3 } }]);
    expect(result.distinct).toBe(1);
    expect(result.total).toBe(3);
  });
});

describe('roleHistogram', () => {
  it('counts role occurrences', () => {
    expect(roleHistogram(['miner', 'guard', 'miner', 'idle'])).toEqual({
      miner: 2,
      guard: 1,
      idle: 1,
    });
  });

  it('is empty for no roles', () => {
    expect(roleHistogram([])).toEqual({});
  });
});

describe('buildActionMatrix', () => {
  it('sums per-item buckets into per-bot action totals', () => {
    const byBot: Record<string, BotActionStats> = {
      Alice: { mined: { stone: 10, oak_log: 5 }, crafted: { stick: 4 } },
      Bob: { mined: { iron_ore: 8 } },
    };
    const matrix = buildActionMatrix(byBot);
    expect(matrix.mined).toEqual({ Alice: 15, Bob: 8 });
    expect(matrix.crafted).toEqual({ Alice: 4 });
    // Buckets with no activity stay empty (not dropped — keeps a stable shape).
    expect(matrix.killed).toEqual({});
  });
});

describe('computeCivilizationMetrics', () => {
  it('assembles the full payload from roles + stats', () => {
    const roles = ['miner', 'guard', 'farmer', 'builder']; // uniform 4 → entropy 2
    const statsByBot: Record<string, BotActionStats> = {
      Alice: { mined: { stone: 100 } },
      Bob: { killed: { zombie: 20 } },
      Carol: { mined: { wheat: 30 } },
      Dave: { placed: { oak_planks: 40 } },
    };
    const m = computeCivilizationMetrics(roles, statsByBot);
    expect(m.roleEntropy).toBeCloseTo(2, 10);
    // mined is shared (Alice+Carol → max-share 100/130), killed & placed exclusive.
    expect(m.actionExclusivity).toBeGreaterThan(0);
    expect(m.actionExclusivity).toBeLessThanOrEqual(1);
    expect(m.uniqueItems.distinct).toBe(2); // stone + wheat (mined); others not mined/crafted
    expect(m.roleDistribution).toEqual({ miner: 1, guard: 1, farmer: 1, builder: 1 });
  });

  it('handles an empty fleet without NaN (startup / no-bots case)', () => {
    const m = computeCivilizationMetrics([], {});
    expect(m.roleEntropy).toBe(0);
    expect(m.actionExclusivity).toBe(0);
    expect(m.uniqueItems.distinct).toBe(0);
    expect(m.uniqueItems.total).toBe(0);
    expect(m.roleDistribution).toEqual({});
  });
});
