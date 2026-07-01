#!/usr/bin/env node
/*
 * Convert Sponge Schematic v3 (.schem, blocks nested under `Blocks`) to v2
 * (top-level `Palette` + `BlockData`), which is what prismarine-schematic@1.2.3
 * (used by SchematicStore) can read. Pure NBT-tree restructure — the v3
 * `Blocks.Palette`/`Blocks.Data` tags are byte-identical to v2 `Palette`/
 * `BlockData`, so no block data is reinterpreted. Block entities (chest
 * contents etc.) are dropped — the builder places blocks + states only.
 *
 * Usage: node convert-schem-v3-to-v2.js <file1.schem> [file2.schem ...]
 * Overwrites each file in place (only if it is actually v3).
 */
const fs = require('fs');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

async function convertOne(path) {
  const raw = fs.readFileSync(path);
  const { parsed } = await nbt.parse(raw);
  const root = parsed;                      // { type:'compound', name, value }
  // v3 nests everything under a `Schematic` child; v2 has fields at root.
  const schem = root.value.Schematic ? root.value.Schematic.value : root.value;

  if (!schem.Blocks) {
    return { path, status: 'skipped (already v2 / no Blocks tag)' };
  }
  const blocks = schem.Blocks.value;        // { Palette, Data, BlockEntities? }
  if (!blocks.Palette || !blocks.Data) {
    return { path, status: 'skipped (no Blocks.Palette/Data)' };
  }
  const off = schem.Offset && schem.Offset.value ? schem.Offset.value : [0, 0, 0];

  const v2 = {
    type: 'compound',
    name: 'Schematic',
    value: {
      Version: { type: 'int', value: 2 },
      DataVersion: schem.DataVersion,
      Width: schem.Width,
      Height: schem.Height,
      Length: schem.Length,
      Palette: blocks.Palette,
      PaletteMax: { type: 'int', value: Object.keys(blocks.Palette.value).length },
      BlockData: { type: 'byteArray', value: blocks.Data.value },
      Metadata: {
        type: 'compound',
        value: {
          WEOffsetX: { type: 'int', value: off[0] | 0 },
          WEOffsetY: { type: 'int', value: off[1] | 0 },
          WEOffsetZ: { type: 'int', value: off[2] | 0 },
        },
      },
    },
  };

  const uncompressed = nbt.writeUncompressed(v2);
  const gz = zlib.gzipSync(uncompressed);
  fs.writeFileSync(path, gz);
  const pal = Object.keys(blocks.Palette.value).length;
  const dims = `${schem.Width.value}x${schem.Height.value}x${schem.Length.value}`;
  return { path, status: `converted v3->v2 (${dims}, ${pal} palette entries)` };
}

(async () => {
  const files = process.argv.slice(2);
  for (const f of files) {
    try { console.log((await convertOne(f)).status, '-', f); }
    catch (e) { console.log('ERROR -', f, '-', e.message); }
  }
})();
