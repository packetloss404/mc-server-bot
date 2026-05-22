// node tools/consolidate-explore-skills.js to consolidate explore skills
//
// One-shot migration: collapses the explore_<dir>_for_<N>_blocks combinatorial
// explosion into a single parameterized skill `explore_direction_for_n_blocks`.
//
// What it does:
//   1. Scans skills/index.json for any entry whose name matches
//      ^explore_(east|west|north|south)_for_\d+_blocks$.
//   2. Writes (if missing) a new skill file `explore_direction_for_n_blocks.js`
//      that takes (bot, direction, blocks) and pathfinds the offset.
//   3. Adds the new entry to skills/index.json (idempotent — skips if already
//      present).
//   4. Marks every matched legacy entry with `deprecated: true`. The SkillLibrary
//      load path filters these out, so they stop showing up in search results.
//   5. Does NOT delete any .js files — the source stays on disk so the migration
//      can be reverted by flipping the flags back to false.
//
// Safe to re-run: rerunning skips already-deprecated entries and never rewrites
// the consolidated file if it already exists.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const INDEX_PATH = path.join(SKILLS_DIR, 'index.json');

const LEGACY_NAME_RE = /^explore_(east|west|north|south)_for_\d+_blocks$/;
const NEW_NAME = 'explore_direction_for_n_blocks';
const NEW_FILE = `${NEW_NAME}.js`;

const NEW_SKILL_CODE = `// Parameterized replacement for the explore_<dir>_for_<N>_blocks family.
// Walks the bot \`blocks\` units in the chosen cardinal direction using
// exploreUntil(), with a fallback target near the start position. Pass
// direction as one of 'north' | 'south' | 'east' | 'west' (lower-case).
async function explore_direction_for_n_blocks(bot, direction, blocks) {
  if (typeof blocks !== 'number' || !isFinite(blocks) || blocks <= 0) {
    throw new Error('explore_direction_for_n_blocks: blocks must be a positive number');
  }
  const dir = String(direction || '').toLowerCase();
  const start = bot.entity.position.clone();
  let targetX = start.x;
  let targetZ = start.z;
  if (dir === 'east') targetX = start.x + blocks;
  else if (dir === 'west') targetX = start.x - blocks;
  else if (dir === 'south') targetZ = start.z + blocks;
  else if (dir === 'north') targetZ = start.z - blocks;
  else throw new Error('explore_direction_for_n_blocks: unknown direction ' + dir);

  // exploreUntil caps maxTime at 30s in the host; pass 30 explicitly to make
  // intent obvious and avoid relying on the cap.
  await exploreUntil(dir, 30, () => {
    const p = bot.entity.position;
    const dx = Math.abs(p.x - start.x);
    const dz = Math.abs(p.z - start.z);
    if (dir === 'east' || dir === 'west') {
      if (dx >= blocks) return { x: targetX, y: p.y, z: p.z };
    } else if (dir === 'north' || dir === 'south') {
      if (dz >= blocks) return { x: p.x, y: p.y, z: targetZ };
    }
    return null;
  });
}
`;

function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) {
    throw new Error(`skills index not found at ${INDEX_PATH}`);
  }
  const raw = fs.readFileSync(INDEX_PATH, 'utf-8');
  return JSON.parse(raw);
}

function saveIndex(index) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function ensureNewSkillFile() {
  const filePath = path.join(SKILLS_DIR, NEW_FILE);
  if (fs.existsSync(filePath)) {
    return { written: false, filePath };
  }
  fs.writeFileSync(filePath, NEW_SKILL_CODE);
  return { written: true, filePath };
}

function ensureNewSkillEntry(index) {
  const existing = index.find((e) => e && e.name === NEW_NAME);
  if (existing) {
    // Defensive: if a previous run inserted the entry but then someone flipped
    // it to deprecated, un-deprecate it here so the migration is self-healing.
    if (existing.deprecated) {
      delete existing.deprecated;
      return { added: false, undeprecated: true };
    }
    return { added: false, undeprecated: false };
  }
  index.push({
    name: NEW_NAME,
    description: 'Walk the bot a parameterized number of blocks in a chosen cardinal direction (north/south/east/west).',
    keywords: ['explore', 'walk', 'move', 'direction', 'distance', 'north', 'south', 'east', 'west'],
    file: NEW_FILE,
    quality: 0.5,
    successCount: 0,
    failureCount: 0,
    lastQualityUpdate: Date.now(),
  });
  return { added: true, undeprecated: false };
}

function deprecateLegacyEntries(index) {
  let deprecated = 0;
  let alreadyDeprecated = 0;
  for (const entry of index) {
    if (!entry || typeof entry.name !== 'string') continue;
    if (!LEGACY_NAME_RE.test(entry.name)) continue;
    if (entry.deprecated === true) {
      alreadyDeprecated += 1;
      continue;
    }
    entry.deprecated = true;
    deprecated += 1;
  }
  return { deprecated, alreadyDeprecated };
}

function main() {
  const index = loadIndex();
  const fileResult = ensureNewSkillFile();
  const entryResult = ensureNewSkillEntry(index);
  const deprecateResult = deprecateLegacyEntries(index);
  saveIndex(index);

  console.log('consolidate-explore-skills:');
  console.log(`  new skill file: ${fileResult.written ? 'written' : 'already present'} (${fileResult.filePath})`);
  if (entryResult.added) console.log('  new index entry: added');
  else if (entryResult.undeprecated) console.log('  new index entry: un-deprecated');
  else console.log('  new index entry: already present');
  console.log(`  legacy entries newly deprecated: ${deprecateResult.deprecated}`);
  console.log(`  legacy entries already deprecated: ${deprecateResult.alreadyDeprecated}`);
  console.log('  legacy .js files left in place (not deleted).');
}

main();
