/**
 * Shared core-resource thresholds + keyword groupings.
 *
 * Lifted out of TownBrain.ts (followup #60) so multiple consumers — the
 * brain's demand loop and the cross-town TradeRouteManager — can share a
 * single source of truth instead of keeping near-duplicate copies in sync by
 * hand.
 *
 * Phase-2 hardcoded thresholds. Tier-keyed so a village needs more wood than
 * a founding settlement. A future Phase 5+ pass will make these dynamic.
 */
import type { TownTier } from './PlanItem';

/**
 * Per-tier minimum on-hand counts for each core resource. The demand loop
 * compares aggregate resident inventory against these and queues supply
 * tasks for any shortfall; the trade route manager treats `> 2x threshold`
 * as surplus and `< 1x threshold` as shortage.
 */
export const CORE_RESOURCE_THRESHOLDS: Record<TownTier, Record<string, number>> = {
  founding: { wood: 32, stone: 16, food: 8, iron: 0 },
  village: { wood: 128, stone: 64, food: 32, iron: 8 },
  town: { wood: 384, stone: 256, food: 96, iron: 32 },
};

/**
 * Keyword groupings used to bucket inventory item names into core resources.
 * Each pattern is matched against the bare item name (no `minecraft:` prefix).
 */
export const RESOURCE_KEYWORDS: Record<string, RegExp> = {
  wood: /(_log|_planks|_wood$|^stripped_)/,
  stone: /(^stone$|^cobblestone$|^andesite$|^granite$|^diorite$|_stone$)/,
  food: /(bread|wheat|carrot|potato|beetroot|melon|apple|mutton|beef|chicken|cooked|porkchop|fish|cod|salmon|berries)/,
  iron: /(^iron_ingot$|^iron_ore$|^raw_iron$|^iron_block$)/,
};

/**
 * Default suggested role for each resource shortage. Phase 3+ uses this when
 * tagging swarm tasks so role-specialised bots score the right shortage
 * tasks first.
 */
export const RESOURCE_ROLE: Record<string, string> = {
  wood: 'lumberjack',
  stone: 'miner',
  food: 'farmer',
  iron: 'blacksmith',
};

/**
 * Where each core resource lives in the world. Drives the locational
 * precondition baked into demand-loop supply tasks: the dominant town-task
 * failure was a SURFACE-resource task (food/wood) being claimed by a bot deep
 * underground, which then fruitlessly searched for wheat/trees among deepslate
 * and gave up. The hint tells whichever bot claims the task to relocate
 * vertically FIRST instead of searching in the wrong layer.
 */
export const RESOURCE_LOCALE: Record<string, 'surface' | 'underground'> = {
  wood: 'surface',
  food: 'surface',
  stone: 'underground',
  iron: 'underground',
};

/**
 * Build the locational precondition clause appended to a supply-task
 * description. Empty string for resources with no clear vertical bias.
 */
export function resourceLocaleHint(resource: string): string {
  const locale = RESOURCE_LOCALE[resource];
  if (locale === 'surface') {
    // Wording deliberately avoids the words surface/swim/water/food/etc. so it
    // does not trip the keyword-matched survival categories in TaskGuidance.
    return ' LOCATION: this resource is found ABOVE GROUND in open daylight. If you are underground or walled in by stone/deepslate (low Y, no open sky overhead), travel UP to open sky FIRST: scan your column for the highest solid block (or a grass_block) and moveTo just above it, then search. Do NOT look for it down in the rock.';
  }
  if (locale === 'underground') {
    return ' LOCATION: this resource is found UNDERGROUND. If none is near you at ground level, dig a staircase DOWN to the stone layer FIRST (around Y 0 to 48; never dig straight down under your feet), then search.';
  }
  return '';
}
