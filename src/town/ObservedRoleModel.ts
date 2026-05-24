/**
 * Observed-role inference — Project Sid P1-A.
 *
 * Sid's Fig-9 insight: a bot's *role* is legible from what it actually does,
 * independent of any role it was assigned. DyoBot already persists the raw
 * signal — per-bot action tallies in `data/stats.json` (mined / crafted /
 * smelted / placed / killed / withdrew / deposited, keyed by item) — so this
 * module just buckets those tallies into the town-role vocabulary and returns
 * the dominant one.
 *
 * Two layers, kept apart on purpose:
 *   1. `inferObservedRole(actions)` — a PURE function (no I/O) that scores an
 *      action vector into roles. Trivially unit-testable.
 *   2. `loadObservedRole(botName, dataDir?)` — a thin loader that reads the
 *      bot's row from `stats.json` (same load path StatsTracker uses) and
 *      applies the pure function.
 *
 * Role vocabulary is aligned to `TOWN_ROLES` in `./RoleManager` (the canonical
 * closed set). When the action vector is empty/missing we return the special
 * `IDLE_ROLE` ('idle') so a freshly-spawned bot reads as idle, matching what
 * RoleManager defaults unassigned residents to.
 */
import fs from 'fs';
import path from 'path';
import type { BotStats } from '../voyager/StatsTracker';
import { TOWN_ROLES } from './RoleManager';

/**
 * The slice of `BotStats` the inference looks at — the seven action maps. We
 * accept a `Partial` so callers (and fixtures) can pass only the buckets they
 * care about; missing buckets are treated as empty.
 */
export type BotActionStats = Partial<
  Pick<
    BotStats,
    'mined' | 'crafted' | 'smelted' | 'placed' | 'killed' | 'withdrew' | 'deposited'
  >
>;

export interface ObservedRoleResult {
  observedRole: string;
  /** Per-role weighted score. Always carries every TOWN_ROLES key (zeroed). */
  scores: Record<string, number>;
}

/** Returned when there's no signal at all (empty/missing stats). */
export const IDLE_ROLE = 'idle';

/**
 * Keyword tables. We classify items by substring match against their id so the
 * model degrades gracefully across the huge Minecraft item space (every wood
 * species, every ore, etc.) without enumerating each one. Order doesn't
 * matter; a single item can contribute to several roles (e.g. an iron_pickaxe
 * craft hints blacksmith *and* miner) and the scoring sums those.
 */
const WOOD_KEYWORDS = ['_log', '_wood', '_stem', '_hyphae'];
const ORE_KEYWORDS = ['ore', 'cobblestone', 'deepslate', 'granite', 'diorite', 'andesite', 'tuff'];
const STONE_MINE_KEYWORDS = [...ORE_KEYWORDS, 'stone'];
const FARM_KEYWORDS = [
  'wheat',
  'seed',
  'carrot',
  'potato',
  'beetroot',
  'melon',
  'pumpkin',
  'sugar_cane',
  'hoe',
  'bone_meal',
  'crop',
  'nether_wart',
  'cocoa',
];
const COMBAT_CRAFT_KEYWORDS = [
  'sword',
  'shield',
  'bow',
  'arrow',
  'armor',
  'helmet',
  'chestplate',
  'leggings',
  'boots',
  'crossbow',
  'axe', // double-edged: also a tool, but combat-adjacent — weighted lightly below
];
const SMITH_CRAFT_KEYWORDS = [
  'pickaxe',
  'axe',
  'shovel',
  'hoe',
  'sword',
  'shield',
  'shears',
  'bucket',
  'flint_and_steel',
  'ingot',
];
const HOSTILE_MOBS = [
  'zombie',
  'skeleton',
  'creeper',
  'spider',
  'enderman',
  'witch',
  'slime',
  'phantom',
  'drowned',
  'husk',
  'stray',
  'pillager',
  'vindicator',
  'ravager',
  'blaze',
  'ghast',
  'piglin',
  'hoglin',
  'guardian',
  'silverfish',
];

function sumBucket(bucket: Record<string, number> | undefined): number {
  if (!bucket) return 0;
  let total = 0;
  for (const v of Object.values(bucket)) total += Number(v) || 0;
  return total;
}

/** Sum the counts of items in `bucket` whose id contains any of `keywords`. */
function sumMatching(
  bucket: Record<string, number> | undefined,
  keywords: string[],
): number {
  if (!bucket) return 0;
  let total = 0;
  for (const [name, count] of Object.entries(bucket)) {
    const id = name.toLowerCase();
    if (keywords.some((kw) => id.includes(kw))) total += Number(count) || 0;
  }
  return total;
}

function zeroScores(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const role of TOWN_ROLES) out[role] = 0;
  return out;
}

/**
 * Pure classifier. Buckets an action vector into weighted per-role scores and
 * returns the dominant role.
 *
 * Scoring rationale (Sid Fig-9 heuristic — counts, not LLM):
 *  - miner       — mining stone/ores; crafting mining tools is a weak hint.
 *  - lumberjack  — mining logs/wood.
 *  - farmer      — mining/crafting/placing farm items (seeds, crops, hoes).
 *  - guard       — killing hostile mobs (strong) + crafting weapons/armor.
 *  - builder     — placing blocks (the defining builder action).
 *  - blacksmith  — smelting (strong) + crafting tools/ingots.
 *  - gatherer    — chest traffic (withdrew/deposited) + general non-specialised
 *                  mining; the generalist hauler bucket.
 *  - idle        — never scored; emitted only when every score is ~0.
 *
 * Weights are relative, not absolute — they only need to rank correctly. A
 * single decisive action (a kill, a smelt) is weighted heavier than a unit of
 * bulk mining so a guard who also chops a little wood still reads as a guard.
 */
export function inferObservedRole(actions: BotActionStats): ObservedRoleResult {
  const scores = zeroScores();

  const mined = actions.mined;
  const crafted = actions.crafted;
  const smelted = actions.smelted;
  const placed = actions.placed;
  const killed = actions.killed;
  const withdrew = actions.withdrew;
  const deposited = actions.deposited;

  // ── Lumberjack: logs mined. ──
  const woodMined = sumMatching(mined, WOOD_KEYWORDS);
  scores.lumberjack += woodMined * 1.0;

  // ── Miner: ores + stone mined; bias toward ore. Mining tool crafts hint. ──
  const oreMined = sumMatching(mined, ORE_KEYWORDS);
  const stoneMined = sumMatching(mined, STONE_MINE_KEYWORDS);
  scores.miner += oreMined * 1.5 + (stoneMined - oreMined) * 1.0;
  scores.miner += sumMatching(crafted, ['pickaxe']) * 0.5;

  // ── Farmer: any farm-keyword item touched (mined/crafted/placed). ──
  scores.farmer += sumMatching(mined, FARM_KEYWORDS) * 1.5;
  scores.farmer += sumMatching(crafted, FARM_KEYWORDS) * 1.0;
  scores.farmer += sumMatching(placed, FARM_KEYWORDS) * 1.5;

  // ── Guard: hostile-mob kills dominate; weapon/armor crafts reinforce. ──
  const hostileKills = sumMatching(killed, HOSTILE_MOBS);
  const otherKills = sumBucket(killed) - hostileKills;
  scores.guard += hostileKills * 5.0 + otherKills * 1.0;
  scores.guard += sumMatching(crafted, COMBAT_CRAFT_KEYWORDS) * 2.0;

  // ── Builder: blocks placed (don't count farm placements — those went to
  //    farmer above). ──
  const totalPlaced = sumBucket(placed);
  const farmPlaced = sumMatching(placed, FARM_KEYWORDS);
  scores.builder += (totalPlaced - farmPlaced) * 1.5;

  // ── Blacksmith: smelting is the defining act; tool/ingot crafts reinforce. ──
  scores.blacksmith += sumBucket(smelted) * 3.0;
  scores.blacksmith += sumMatching(crafted, SMITH_CRAFT_KEYWORDS) * 1.0;

  // ── Gatherer: chest traffic + non-specialised mining (the generalist). ──
  const chestTraffic = sumBucket(withdrew) + sumBucket(deposited);
  scores.gatherer += chestTraffic * 1.5;
  // Dirt/gravel/sand and other plain blocks read as generic gathering.
  scores.gatherer += sumMatching(mined, ['dirt', 'gravel', 'sand', 'grass_block', 'clay']) * 0.5;

  // Pick the winner. 'idle' is excluded from the contest — it only wins by
  // default when nothing scored.
  let best: string = IDLE_ROLE;
  let bestScore = 0;
  for (const role of TOWN_ROLES) {
    if (role === IDLE_ROLE) continue;
    if (scores[role] > bestScore) {
      bestScore = scores[role];
      best = role;
    }
  }

  return { observedRole: best, scores };
}

/**
 * Read a single bot's action vector from `stats.json` and infer its role.
 *
 * Mirrors StatsTracker's load path (plain `fs.readFileSync` of
 * `<dataDir>/stats.json`) rather than reaching into a StatsTracker instance —
 * the trackers live inside per-bot worker threads, so the API process only has
 * the on-disk file. Returns the idle result when the file is missing/corrupt
 * or the bot has no row, so callers never have to special-case absence.
 */
export function loadObservedRole(
  botName: string,
  dataDir = './data',
): ObservedRoleResult {
  const filePath = path.join(dataDir, 'stats.json');
  let all: Record<string, BotActionStats> = {};
  try {
    if (fs.existsSync(filePath)) {
      all = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, BotActionStats>;
    }
  } catch {
    all = {};
  }
  const row = all[botName];
  if (!row) return { observedRole: IDLE_ROLE, scores: zeroScores() };
  return inferObservedRole(row);
}
