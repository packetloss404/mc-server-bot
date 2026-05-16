/**
 * Founding-style seeds.
 *
 * Both presets are concrete starter `style.json` templates the founding flow
 * picks between. The first ~20 buildings of a town are constrained to its
 * chosen preset (TOWN_BUILDER_SPEC.md §6); from there the style doc evolves
 * as buildings succeed.
 *
 * - `medieval-communal` — Witcher-3-village vibe. Cobblestone + oak palette,
 *   steep gabled roofs, half-timbered facades, small leaded windows.
 * - `mid-century-civic`  — 1950s/60s American downtown. Smooth_stone +
 *   concrete palette, flat roofs, columned entries, glass storefronts.
 */
import type { StyleDoc, StyleSeed } from './StyleDoc';

/** Build the medieval-communal seed for a given town id. */
export function defaultMedievalStyle(townId: string, now: number = Date.now()): StyleDoc {
  return {
    townId,
    lastObservedAt: now,
    block_palette: {
      common: ['cobblestone', 'oak_planks', 'dark_oak_planks', 'stone_bricks'],
      accent: ['iron_block', 'lantern', 'bookshelf'],
      roof: ['dark_oak_stairs'],
      floor: ['cobblestone', 'oak_planks'],
    },
    dimensions: {
      house_avg: { w: 9, h: 6, d: 11 },
      civic_avg: { w: 19, h: 12, d: 23 },
    },
    patterns: {
      roof_style: 'gabled',
      wall_height_typical: 5,
      windows: 'small_leaded',
      facade_features: ['half_timbered', 'wood_door', 'cobblestone_base'],
    },
    seed_style: 'medieval-communal',
  };
}

/** Build the mid-century-civic seed for a given town id. */
export function defaultMidcenturyStyle(townId: string, now: number = Date.now()): StyleDoc {
  return {
    townId,
    lastObservedAt: now,
    block_palette: {
      common: [
        'smooth_stone',
        'polished_andesite',
        'white_concrete',
        'light_gray_concrete',
      ],
      accent: ['dark_oak_planks', 'iron_block'],
      roof: ['smooth_stone_slab'],
      floor: ['polished_andesite'],
    },
    dimensions: {
      house_avg: { w: 11, h: 5, d: 13 },
      civic_avg: { w: 23, h: 10, d: 27 },
    },
    patterns: {
      roof_style: 'flat',
      wall_height_typical: 4,
      windows: 'modern_strip',
      facade_features: ['columned_entry', 'glass_storefront', 'centered_door'],
    },
    seed_style: 'mid-century-civic',
  };
}

/**
 * Dispatch helper — pick the right seed builder for the requested preset.
 * Defaults to mid-century when given anything other than `'medieval-communal'`
 * (mid-century is the Phase 2 seeded style per the spec rollout plan).
 */
export function buildSeedStyle(
  preset: StyleSeed,
  townId: string,
  now: number = Date.now(),
): StyleDoc {
  if (preset === 'medieval-communal') {
    return defaultMedievalStyle(townId, now);
  }
  return defaultMidcenturyStyle(townId, now);
}
