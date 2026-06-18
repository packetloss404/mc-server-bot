/**
 * One-time backfill: register completed build-JOB structures that were never
 * recorded in the town `buildings` registry, and enrich the two existing rows
 * (well, town_hall) whose footprint dims were null.
 *
 * Context: before the TownBrain footprint-persistence fix, town builds that
 * went through the build-JOB path (victorian palace, sam-cottage, birch house)
 * completed without ever creating a registry row, and the well/town_hall rows
 * that did exist carried null width/height/depth. The rail-network connector
 * sidestepped this by re-deriving footprints from completed jobs; this script
 * makes the registry itself authoritative so no manual backfill is needed again.
 *
 * Footprints are read straight from the .schem NBT (Width/Height/Length), which
 * is version-independent. width=Width(x), height=Height(y), depth=Length(z) —
 * the same mapping the connector uses (info.size.x/y/z).
 *
 * Idempotent: skips inserting a structure whose origin already has a row.
 * Run with dyobot STOPPED so this is the only writer to town.db.
 */
import Database from 'better-sqlite3';
import nbt from 'prismarine-nbt';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'town.db');
const SCHEM_DIR = path.join(ROOT, 'schematics');
const TOWN_ID = 'town_mph4x8tz_e3237864'; // Hollybrook

const genId = (prefix) => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;

async function footprint(schemFile) {
  const buf = fs.readFileSync(path.join(SCHEM_DIR, schemFile));
  const { parsed } = await nbt.parse(buf);
  const root = parsed.value.Schematic ? parsed.value.Schematic.value : parsed.value;
  const get = (k) => (root[k] ? root[k].value : undefined);
  return { width: get('Width'), height: get('Height'), depth: get('Length') };
}

// Completed build-JOB structures near Hollybrook that have no registry row.
const NEW_BUILDINGS = [
  { kind: 'palace',  schemFile: 'victorian palace.schem', ref: 'victorian palace', origin: { x: 1626, y: 64, z: 194 }, builtAt: 1779767766064 },
  { kind: 'house',   schemFile: 'sam-cottage.schem',      ref: 'sam-cottage',      origin: { x: 1635, y: 64, z: 120 }, builtAt: 1779770283326 },
  { kind: 'house',   schemFile: 'birch house.schem',      ref: 'birch house',      origin: { x: 1712, y: 65, z: 188 }, builtAt: 1781748407539 },
];

// Existing rows with null dims → enrich from their schematic.
const ENRICH = [
  { matchName: 'town_hall:%', schemFile: 'small medieval town hall.schem' },
  { matchName: 'well:%',      schemFile: 'town_mph4x8tz_e3237864/well-18de54a2c7.schem' },
];

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const insert = db.prepare(`
  INSERT INTO buildings
    (id, town_id, district_id, name, schematic_source, schematic_ref,
     origin_x, origin_y, origin_z, width, height, depth, built_at, destroyed_at, status)
  VALUES
    (@id, @townId, NULL, @name, 'library', @ref,
     @ox, @oy, @oz, @width, @height, @depth, @builtAt, NULL, 'complete')
`);
const existsAtOrigin = db.prepare(
  `SELECT id, name FROM buildings WHERE town_id = ? AND origin_x = ? AND origin_y = ? AND origin_z = ?`,
);

for (const b of NEW_BUILDINGS) {
  const dup = existsAtOrigin.get(TOWN_ID, b.origin.x, b.origin.y, b.origin.z);
  if (dup) {
    console.log(`skip ${b.ref}: row already exists at origin (${dup.id} / ${dup.name})`);
    continue;
  }
  const fp = await footprint(b.schemFile);
  const id = genId('bld');
  const name = `${b.kind}:${id.split('_')[1]}`;
  insert.run({
    id, townId: TOWN_ID, name, ref: b.ref,
    ox: b.origin.x, oy: b.origin.y, oz: b.origin.z,
    width: fp.width, height: fp.height, depth: fp.depth, builtAt: b.builtAt,
  });
  console.log(`registered ${b.ref} → ${id} (${name}) origin ${b.origin.x},${b.origin.y},${b.origin.z} dims ${fp.width}x${fp.height}x${fp.depth}`);
}

const findByName = db.prepare(`SELECT id, name, width FROM buildings WHERE town_id = ? AND name LIKE ?`);
const setDims = db.prepare(`UPDATE buildings SET width=@w, height=@h, depth=@d WHERE id=@id`);
for (const e of ENRICH) {
  const row = findByName.get(TOWN_ID, e.matchName);
  if (!row) { console.log(`enrich: no row matching ${e.matchName}`); continue; }
  if (row.width != null) { console.log(`enrich: ${row.name} already has dims; skipping`); continue; }
  const fp = await footprint(e.schemFile);
  setDims.run({ id: row.id, w: fp.width, h: fp.height, d: fp.depth });
  console.log(`enriched ${row.name} (${row.id}) dims ${fp.width}x${fp.height}x${fp.depth}`);
}

console.log('\n=== buildings after backfill ===');
for (const r of db.prepare(`SELECT name,status,origin_x,origin_y,origin_z,width,height,depth FROM buildings WHERE town_id=? ORDER BY name`).all(TOWN_ID)) {
  console.log(JSON.stringify(r));
}
db.close();
