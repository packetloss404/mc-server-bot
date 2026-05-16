/**
 * Tiny 3-block "plaque" Sam can finish with his 3 cobblestone.
 * Same SchematicEncoder pipeline as the cottage demo, sized to existing
 * inventory so the build completes 100%.
 */
import path from 'path';
import { encodeAndSave } from '../src/town/SchematicEncoder';
import type { BlockPlan } from '../src/town/DesignCache';

const plan: BlockPlan = {
  kind: 'plaque',
  style: 'medieval-communal',
  dimensions: { w: 3, h: 1, d: 1 },
  blocks: [
    { x: 0, y: 0, z: 0, name: 'cobblestone' },
    { x: 1, y: 0, z: 0, name: 'cobblestone' },
    { x: 2, y: 0, z: 0, name: 'cobblestone' },
  ],
  notes: '3-block plaque — Sam can finish this from current inventory.',
};

async function main() {
  const result = await encodeAndSave(plan, {
    rootDir: path.join(process.cwd(), 'schematics'),
    townId: 'sam-demo',
    filename: 'sam-plaque.schem',
  });
  console.log(`Encoded ${plan.blocks.length} blocks → ${result.filename} (${result.byteSize} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
