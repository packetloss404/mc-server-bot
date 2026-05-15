import { describe, it, expect } from 'vitest';
import { Vec3 } from 'vec3';
import { checkShelter } from '../../src/actions/shelterCheck';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface FakeBlock {
  name: string;
  boundingBox: 'block' | 'empty';
  light?: number;
}

const SOLID: FakeBlock = { name: 'stone', boundingBox: 'block', light: 0 };
const AIR: FakeBlock = { name: 'air', boundingBox: 'empty', light: 15 };

/**
 * Build a minimal mock bot whose `blockAt(pos)` returns blocks from a sparse
 * map keyed by `${x},${y},${z}`, defaulting to AIR if not specified. The bot
 * stands at (0, 64, 0).
 */
function makeBot(blocks: Record<string, FakeBlock>, opts?: { lightAtFeet?: number }) {
  const feet = new Vec3(0, 64, 0);
  if (opts?.lightAtFeet !== undefined) {
    const key = `${feet.x},${feet.y},${feet.z}`;
    blocks[key] = { name: 'air', boundingBox: 'empty', light: opts.lightAtFeet };
  }
  return {
    entity: { position: feet },
    blockAt: (pos: Vec3) => {
      const key = `${pos.x},${pos.y},${pos.z}`;
      return blocks[key] ?? AIR;
    },
  } as any;
}

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/**
 * Helper that constructs a full enclosure (roof + 4 walls at both rows)
 * around the bot at (0, 64, 0).
 */
function fullyEnclosedBlocks(): Record<string, FakeBlock> {
  return {
    // Roof above the bot's head
    [key(0, 66, 0)]: SOLID,
    // Floor-level walls (y = 64)
    [key(1, 64, 0)]: SOLID,
    [key(-1, 64, 0)]: SOLID,
    [key(0, 64, 1)]: SOLID,
    [key(0, 64, -1)]: SOLID,
    // Eye-level walls (y = 65)
    [key(1, 65, 0)]: SOLID,
    [key(-1, 65, 0)]: SOLID,
    [key(0, 65, 1)]: SOLID,
    [key(0, 65, -1)]: SOLID,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('checkShelter', () => {
  it('reports safe=true when fully enclosed (roof + 4 walls on both rows)', () => {
    const bot = makeBot(fullyEnclosedBlocks(), { lightAtFeet: 7 });
    const result = checkShelter(bot);

    expect(result.safe).toBe(true);
    expect(result.hasRoof).toBe(true);
    expect(result.wallsCovered).toBe(4);
    expect(result.exposedSides).toEqual([]);
    expect(result.lightLevel).toBe(7);
    expect(result.reason).toMatch(/fully enclosed/i);
  });

  it('reports safe=false when the roof is missing but walls are complete', () => {
    const blocks = fullyEnclosedBlocks();
    delete blocks[key(0, 66, 0)]; // remove roof

    const bot = makeBot(blocks);
    const result = checkShelter(bot);

    expect(result.safe).toBe(false);
    expect(result.hasRoof).toBe(false);
    expect(result.wallsCovered).toBe(4);
    expect(result.exposedSides).toEqual([]);
    expect(result.reason).toMatch(/missing roof/i);
  });

  it('reports safe=false when one wall is missing (eye-level open on north)', () => {
    const blocks = fullyEnclosedBlocks();
    // Remove the north eye-level block — floor row still solid, but the wall
    // is not complete because BOTH rows must be solid to count.
    delete blocks[key(0, 65, -1)];

    const bot = makeBot(blocks);
    const result = checkShelter(bot);

    expect(result.safe).toBe(false);
    expect(result.hasRoof).toBe(true);
    expect(result.wallsCovered).toBe(3);
    expect(result.exposedSides).toEqual(['north']);
    expect(result.reason).toMatch(/incomplete walls/i);
  });

  it('reports safe=false in open air with no roof and no walls', () => {
    const bot = makeBot({}); // empty — everything defaults to AIR
    const result = checkShelter(bot);

    expect(result.safe).toBe(false);
    expect(result.hasRoof).toBe(false);
    expect(result.wallsCovered).toBe(0);
    expect(result.exposedSides.sort()).toEqual(['east', 'north', 'south', 'west']);
    expect(result.lightLevel).toBe(15);
    expect(result.reason).toMatch(/open air/i);
  });

  it('tolerates missing block.light field (defaults to 0)', () => {
    // Strip the light field entirely from the block at the bot's feet.
    const blocks: Record<string, FakeBlock> = {
      [key(0, 64, 0)]: { name: 'air', boundingBox: 'empty' } as FakeBlock,
    };
    const bot = makeBot(blocks);
    const result = checkShelter(bot);

    expect(result.lightLevel).toBe(0);
    // Light absence must not gate safety — but here we're not enclosed anyway.
    expect(result.safe).toBe(false);
  });

  it('returns a defensive failure when bot.entity is absent', () => {
    const bot = { entity: null, blockAt: () => AIR } as any;
    const result = checkShelter(bot);

    expect(result.safe).toBe(false);
    expect(result.hasRoof).toBe(false);
    expect(result.wallsCovered).toBe(0);
    expect(result.exposedSides).toEqual(['north', 'south', 'east', 'west']);
    expect(result.reason).toMatch(/no entity/i);
  });
});
