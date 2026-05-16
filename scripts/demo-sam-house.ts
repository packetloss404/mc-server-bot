/**
 * Demo: generate a small medieval house BlockPlan, encode to .schem via the
 * Phase 9 SchematicEncoder, then queue a build via the BuildCoordinator API.
 *
 * This bypasses the TownBrain's seed-plan order so we can demo the
 * JSON-design → .schem → buildable pipeline end-to-end without waiting for
 * the brain to design town_hall first (which the LLM keeps timing out on).
 *
 * Run with: node -r ts-node/register scripts/demo-sam-house.ts
 * Or after npm run build: node dist/scripts/demo-sam-house.js
 */
import path from 'path';
import { encodeAndSave } from '../src/town/SchematicEncoder';
import type { BlockPlan } from '../src/town/DesignCache';

// A hand-crafted 7x5x7 medieval cottage. Footprint stays well within the
// validator's bounds; no floating blocks (every non-bottom block has a
// neighbor in the plan); fits comfortably in any chunk.
function makeCottagePlan(): BlockPlan {
  const w = 7,
    h = 5,
    d = 7;
  const blocks: Array<{ x: number; y: number; z: number; name: string }> = [];

  // Foundation — cobblestone slab on y=0.
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      blocks.push({ x, y: 0, z, name: 'cobblestone' });
    }
  }

  // Walls — oak planks, 3 blocks tall (y=1..3), perimeter only.
  for (let y = 1; y <= 3; y++) {
    for (let x = 0; x < w; x++) {
      blocks.push({ x, y, z: 0, name: 'oak_planks' });
      blocks.push({ x, y, z: d - 1, name: 'oak_planks' });
    }
    for (let z = 1; z < d - 1; z++) {
      blocks.push({ x: 0, y, z, name: 'oak_planks' });
      blocks.push({ x: w - 1, y, z, name: 'oak_planks' });
    }
  }

  // Doorway — leave the centre block on z=0 empty (no block to add).
  // Drop the two oak_planks that filled it so the door is open.
  const doorX = Math.floor(w / 2);
  const dropped = blocks.filter(
    (b) => !((b.x === doorX || b.x === doorX) && b.y >= 1 && b.y <= 2 && b.z === 0),
  );
  // (No-op filter to keep the explicit doorway logic readable below.)

  const final = dropped.filter(
    (b) =>
      !(
        b.name === 'oak_planks' &&
        b.x === doorX &&
        b.z === 0 &&
        (b.y === 1 || b.y === 2)
      ),
  );

  // Windows — drop a glass block at (1, 2, 0) and (w-2, 2, 0).
  for (let i = 0; i < final.length; i++) {
    if (
      final[i].name === 'oak_planks' &&
      final[i].y === 2 &&
      (final[i].x === 1 || final[i].x === w - 2) &&
      (final[i].z === 0 || final[i].z === d - 1)
    ) {
      final[i].name = 'glass';
    }
  }

  // Roof — dark oak slab (treated as a regular block here) at y=4, full coverage.
  for (let x = 0; x < w; x++) {
    for (let z = 0; z < d; z++) {
      final.push({ x, y: 4, z, name: 'dark_oak_planks' });
    }
  }

  return {
    kind: 'house',
    style: 'medieval-communal',
    dimensions: { w, h, d },
    blocks: final,
    notes: 'Small medieval cottage — demo for Sam',
  };
}

async function main() {
  const plan = makeCottagePlan();
  console.log(`Generated cottage plan: ${plan.blocks.length} blocks (${plan.dimensions.w}x${plan.dimensions.h}x${plan.dimensions.d})`);

  const rootDir = path.join(process.cwd(), 'schematics');
  const townId = 'sam-demo';
  const filename = 'sam-cottage.schem';
  const result = await encodeAndSave(plan, {
    rootDir,
    townId,
    filename,
  });
  console.log(`Encoded → ${result.filename} (${result.byteSize} bytes)`);

  // The build API expects schematicFile RELATIVE to schematics/ root.
  const relativePath = `${townId}/${filename}`;
  console.log(`\nNow queue the build with:`);
  console.log(`  curl -s -X POST http://127.0.0.1:3001/api/builds \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{`);
  console.log(`      "schematicFile":"${relativePath}",`);
  console.log(`      "origin":{"x":1665,"y":64,"z":215},`);
  console.log(`      "botNames":["Sam"],`);
  console.log(`      "options":{"originMode":"auto-flat"}`);
  console.log(`    }'`);
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
