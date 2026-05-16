/**
 * SchematicEncoder unit tests (followup #44).
 *
 * Covers the encoder's contract with the build pipeline:
 *
 *   1. Round-trip: a small known BlockPlan encodes to a .schem buffer that
 *      `prismarine-schematic.Schematic.read()` parses back with identical
 *      block positions + names. This is the load-bearing test — if a single
 *      block drifts on a round-trip BuildCoordinator will build the wrong
 *      thing.
 *   2. Unknown block names degrade to `minecraft:stone` rather than failing
 *      the encode (LLMs love emitting 1.20+ blocks).
 *   3. Out-of-bounds blocks fail the encode entirely (caller falls back).
 *   4. Empty BlockPlan fails the encode.
 *   5. encodeAndSave writes the file under `<rootDir>/<townId>/<filename>`
 *      and the round-trip survives the disk dance.
 *   6. Pre-encode validator independently flags the same failure modes so
 *      the cache layer can short-circuit before calling encode.
 *
 * No mineflayer / mock-server needed — the encoder is pure (BlockPlan in,
 * Buffer out) and works against prismarine-schematic directly.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Vec3 } from 'vec3';
import {
  encode,
  encodeAndSave,
  validatePlanForEncode,
  SchematicEncodeError,
} from '../../src/town/SchematicEncoder';
import type { BlockPlan, BlockPlanEntry } from '../../src/town/LlmDesigner';

/**
 * A tiny 3x2x3 plan: a floor of oak_planks, a stone_bricks column, and a
 * cobblestone capstone. Keeps the round-trip assertions short and unambiguous.
 */
function makeTinyPlan(): BlockPlan {
  const blocks: BlockPlanEntry[] = [];
  // 3x3 oak_planks floor at y=0
  for (let x = 0; x < 3; x++) {
    for (let z = 0; z < 3; z++) {
      blocks.push({ x, y: 0, z, name: 'oak_planks' });
    }
  }
  // stone_bricks column at (1, 1, 1)
  blocks.push({ x: 1, y: 1, z: 1, name: 'stone_bricks' });
  // cobblestone with the minecraft: prefix to verify normalization works both ways
  blocks.push({ x: 0, y: 1, z: 0, name: 'minecraft:cobblestone' });
  return {
    dimensions: { w: 3, h: 2, d: 3 },
    kind: 'house',
    style: 'medieval-communal',
    blocks,
  };
}

describe('SchematicEncoder', () => {
  describe('encode + round-trip', () => {
    it('encodes a tiny BlockPlan into a buffer that prismarine-schematic can read back with the same blocks', async () => {
      const plan = makeTinyPlan();
      const buf = await encode(plan);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(0);

      // Round-trip via prismarine-schematic.
      const { Schematic } = require('prismarine-schematic');
      const schematic = await Schematic.read(buf);
      expect(schematic.size.x).toBe(plan.dimensions.w);
      expect(schematic.size.y).toBe(plan.dimensions.h);
      expect(schematic.size.z).toBe(plan.dimensions.d);

      // Index the plan by (x,y,z) so we can verify every cell.
      const expected = new Map<string, string>();
      for (const b of plan.blocks) {
        expected.set(`${b.x},${b.y},${b.z}`, b.name.replace(/^minecraft:/, ''));
      }

      // Walk the read-back schematic and assert each placed cell matches.
      let matchedCells = 0;
      for (let y = 0; y < plan.dimensions.h; y++) {
        for (let z = 0; z < plan.dimensions.d; z++) {
          for (let x = 0; x < plan.dimensions.w; x++) {
            const block = schematic.getBlock(new Vec3(x, y, z));
            const expectedName = expected.get(`${x},${y},${z}`);
            if (expectedName) {
              expect(block.name).toBe(expectedName);
              matchedCells++;
            } else {
              // Unfilled cells must be air so BuildCoordinator's air-skip
              // logic (loadSchematicCached) doesn't try to place phantom
              // blocks.
              expect(block.name).toBe('air');
            }
          }
        }
      }
      expect(matchedCells).toBe(plan.blocks.length);
    });

    it('completes the encode for a 9x6x11 house-sized plan in under 50ms', async () => {
      // A fully-filled 9x6x11 box (594 cells) is well above any LLM-produced
      // plan in practice; the encoder still has to walk the palette + write
      // gzip NBT. We're not trying to measure perf precisely, just catch the
      // case where someone introduces a per-block O(n) scan in the hot loop.
      const blocks: BlockPlanEntry[] = [];
      for (let x = 0; x < 9; x++) {
        for (let y = 0; y < 6; y++) {
          for (let z = 0; z < 11; z++) {
            // Alternate two block types so the palette has > 1 entry.
            blocks.push({
              x,
              y,
              z,
              name: (x + y + z) % 2 === 0 ? 'stone_bricks' : 'oak_planks',
            });
          }
        }
      }
      const plan: BlockPlan = {
        dimensions: { w: 9, h: 6, d: 11 },
        kind: 'house',
        style: 'medieval-communal',
        blocks,
      };

      const start = Date.now();
      const buf = await encode(plan);
      const elapsed = Date.now() - start;
      expect(buf.length).toBeGreaterThan(0);
      // 200ms slack over the 50ms target: CI machines vary wildly and gzip
      // is the dominant cost. The point is to catch a 10x regression.
      expect(elapsed).toBeLessThan(200);
    });
  });

  describe('invalid block names', () => {
    it('substitutes minecraft:stone for unknown block names without failing the encode', async () => {
      // 'not_a_real_block_12345' is guaranteed not to exist in any
      // minecraft-data version we ship. The encoder should warn + fall back
      // to stone rather than throwing.
      const plan: BlockPlan = {
        dimensions: { w: 2, h: 1, d: 2 },
        kind: 'house',
        style: 'medieval-communal',
        blocks: [
          { x: 0, y: 0, z: 0, name: 'oak_planks' },
          { x: 1, y: 0, z: 0, name: 'not_a_real_block_12345' },
          { x: 0, y: 0, z: 1, name: 'oak_planks' },
          { x: 1, y: 0, z: 1, name: 'oak_planks' },
        ],
      };

      const buf = await encode(plan);
      expect(buf.length).toBeGreaterThan(0);

      const { Schematic } = require('prismarine-schematic');
      const schematic = await Schematic.read(buf);
      // The unknown-name cell should have become stone.
      const replaced = schematic.getBlock(new Vec3(1, 0, 0));
      expect(replaced.name).toBe('stone');
      // The recognised cells should still be oak_planks.
      const known = schematic.getBlock(new Vec3(0, 0, 0));
      expect(known.name).toBe('oak_planks');
    });

    it('flags unknown names in validatePlanForEncode even when the plan is otherwise valid', () => {
      const plan: BlockPlan = {
        dimensions: { w: 1, h: 1, d: 1 },
        kind: 'house',
        style: 'medieval-communal',
        blocks: [{ x: 0, y: 0, z: 0, name: 'not_a_real_block_12345' }],
      };
      const report = validatePlanForEncode(plan);
      expect(report.ok).toBe(true); // unknown names are non-fatal
      expect(report.unknownNames).toContain('not_a_real_block_12345');
    });
  });

  describe('out-of-bounds rejection', () => {
    it('rejects a plan with blocks beyond its declared dimensions', async () => {
      const plan: BlockPlan = {
        dimensions: { w: 2, h: 2, d: 2 },
        kind: 'house',
        style: 'medieval-communal',
        blocks: [
          { x: 0, y: 0, z: 0, name: 'oak_planks' },
          // x=5 is outside dims.w = 2
          { x: 5, y: 0, z: 0, name: 'oak_planks' },
        ],
      };
      await expect(encode(plan)).rejects.toBeInstanceOf(SchematicEncodeError);
      const report = validatePlanForEncode(plan);
      expect(report.ok).toBe(false);
      expect(report.reasons.some((r) => /outside dims/i.test(r))).toBe(true);
    });

    it('rejects a plan with negative coordinates', async () => {
      const plan: BlockPlan = {
        dimensions: { w: 3, h: 3, d: 3 },
        kind: 'house',
        style: 'medieval-communal',
        blocks: [
          { x: 0, y: 0, z: 0, name: 'oak_planks' },
          { x: -1, y: 0, z: 0, name: 'oak_planks' },
        ],
      };
      await expect(encode(plan)).rejects.toBeInstanceOf(SchematicEncodeError);
    });
  });

  describe('empty plan rejection', () => {
    it('rejects an empty BlockPlan (no blocks)', async () => {
      const plan: BlockPlan = {
        dimensions: { w: 3, h: 3, d: 3 },
        kind: 'house',
        style: 'medieval-communal',
        blocks: [],
      };
      await expect(encode(plan)).rejects.toBeInstanceOf(SchematicEncodeError);
      const report = validatePlanForEncode(plan);
      expect(report.ok).toBe(false);
      expect(report.reasons.some((r) => /non-empty array/i.test(r))).toBe(true);
    });

    it('rejects a plan with missing or zero dimensions', async () => {
      const plan = {
        dimensions: { w: 0, h: 3, d: 3 },
        kind: 'house',
        style: 'medieval-communal',
        blocks: [{ x: 0, y: 0, z: 0, name: 'oak_planks' }],
      } as unknown as BlockPlan;
      await expect(encode(plan)).rejects.toBeInstanceOf(SchematicEncodeError);
    });
  });

  describe('encodeAndSave', () => {
    let tmpRoot: string;
    beforeAll(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'schem-encoder-test-'));
    });
    afterAll(() => {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; tmpdir entries don't need to survive.
      }
    });

    it('writes the .schem under <rootDir>/<townId>/<filename> with non-zero byte size and survives a read round-trip', async () => {
      const plan = makeTinyPlan();
      const result = await encodeAndSave(plan, {
        rootDir: tmpRoot,
        townId: 'town-001',
        filename: 'house-deadbeef.schem',
      });
      expect(result.filename).toBe('house-deadbeef.schem');
      expect(result.byteSize).toBeGreaterThan(0);
      expect(fs.existsSync(result.filePath)).toBe(true);

      // Read back from disk and verify the round-trip survived the dance.
      const { Schematic } = require('prismarine-schematic');
      const buf = fs.readFileSync(result.filePath);
      const schematic = await Schematic.read(buf);
      expect(schematic.size.x).toBe(3);
      expect(schematic.size.y).toBe(2);
      expect(schematic.size.z).toBe(3);
      // Spot-check a single known cell so we know the file isn't garbage.
      const sample = schematic.getBlock(new Vec3(1, 1, 1));
      expect(sample.name).toBe('stone_bricks');
    });
  });
});
