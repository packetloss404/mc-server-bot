import { describe, it, expect, vi } from 'vitest';
import { dropJunk } from '../../src/actions/dropJunk';

type FakeItem = { name: string; count: number; type: number; slot: number };

/**
 * Build a minimal Bot stand-in whose `inventory.items()` reflects whatever the
 * test most recently set, and whose `toss(type, _, count)` mutates that list
 * the same way mineflayer would: subtract count from the matching stack and
 * remove the stack when it hits zero.
 */
function makeBot(initialItems: FakeItem[]) {
  let items = [...initialItems];
  const toss = vi.fn(async (type: number, _metadata: any, count: number) => {
    const idx = items.findIndex((i) => i.type === type);
    if (idx === -1) return;
    items[idx] = { ...items[idx], count: items[idx].count - count };
    if (items[idx].count <= 0) {
      items.splice(idx, 1);
    }
  });
  return {
    bot: {
      inventory: { items: () => items },
      toss,
    } as any,
    getItems: () => items,
    toss,
  };
}

// Type IDs are arbitrary — they only need to be distinct per item name so
// `bot.toss(item.type, ...)` can locate the right stack in our fake.
const TYPE = {
  cobblestone: 4,
  dirt: 3,
  oak_pickaxe: 100,
  diamond_pickaxe: 101,
  oak_sword: 102,
  bread: 200,
  oak_log: 17,
  gravel: 13,
};

describe('dropJunk', () => {
  it('returns success with no drops when used slots are below threshold', async () => {
    const fill: FakeItem[] = [];
    for (let i = 0; i < 10; i++) {
      fill.push({ name: 'cobblestone', count: 64, type: TYPE.cobblestone + i, slot: i });
    }
    const { bot, toss } = makeBot(fill);

    const result = await dropJunk(bot, 6, 30);

    expect(result.success).toBe(true);
    expect(result.message).toBe('inventory ok, no drop needed');
    expect(result.data?.dropped).toBe(0);
    expect(toss).not.toHaveBeenCalled();
  });

  it('drops cobblestone first when over threshold', async () => {
    // 32 slots used, want at least 6 free, so we need to free up at least 2 slots.
    // Layout: 2 cobblestone stacks, 2 dirt stacks, plus 28 unique non-junk filler.
    const items: FakeItem[] = [
      { name: 'cobblestone', count: 64, type: TYPE.cobblestone, slot: 0 },
      { name: 'cobblestone', count: 64, type: TYPE.cobblestone, slot: 1 },
      { name: 'dirt', count: 64, type: TYPE.dirt, slot: 2 },
      { name: 'dirt', count: 64, type: TYPE.dirt, slot: 3 },
    ];
    for (let i = 0; i < 28; i++) {
      items.push({ name: `unique_filler_${i}`, count: 1, type: 1000 + i, slot: 4 + i });
    }

    const { bot, toss, getItems } = makeBot(items);
    const result = await dropJunk(bot, 6, 30);

    expect(result.success).toBe(true);
    expect(result.data?.dropped).toBeGreaterThan(0);

    // First toss must be cobblestone (most-junky-first ordering).
    expect(toss).toHaveBeenCalled();
    expect(toss.mock.calls[0][0]).toBe(TYPE.cobblestone);

    // Verify we have at least 6 free slots now (i.e. <= 30 used).
    expect(getItems().length).toBeLessThanOrEqual(30);

    // Dirt should not have been tossed at all — cobblestone alone freed enough.
    const tossedTypes = toss.mock.calls.map((c) => c[0]);
    expect(tossedTypes).not.toContain(TYPE.dirt);
  });

  it('drops nothing when over threshold but inventory contains only non-junk (tools, food, logs)', async () => {
    // 32 slots, all non-junk: pickaxes, sword, bread, oak logs.
    const items: FakeItem[] = [
      { name: 'oak_pickaxe', count: 1, type: TYPE.oak_pickaxe, slot: 0 },
      { name: 'diamond_pickaxe', count: 1, type: TYPE.diamond_pickaxe, slot: 1 },
      { name: 'oak_sword', count: 1, type: TYPE.oak_sword, slot: 2 },
      { name: 'bread', count: 64, type: TYPE.bread, slot: 3 },
    ];
    for (let i = 0; i < 28; i++) {
      items.push({ name: 'oak_log', count: 64, type: TYPE.oak_log, slot: 4 + i });
    }

    const { bot, toss, getItems } = makeBot(items);
    const before = getItems().length;
    const result = await dropJunk(bot, 6, 30);

    expect(result.success).toBe(true);
    expect(result.data?.dropped).toBe(0);
    expect(toss).not.toHaveBeenCalled();
    expect(getItems().length).toBe(before);
  });
});
