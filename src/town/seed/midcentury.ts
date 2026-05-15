/**
 * Mid-Century Civic starter plan.
 *
 * Encodes the minimum set of buildings a mid-century-civic town must have at
 * each tier. Pairs with `medieval.ts`; both are interchangeable seed plans
 * the brain selects between based on the town's `styleSeed`.
 *
 * Spec source: TOWN_BUILDER_SPEC.md §6 — smooth_stone + concrete palette,
 * flat roofs, columned civic entries, big government buildings, square town
 * blocks for residential, plaza centerpiece.
 */
import type { PlanItem, TownTier } from '../PlanItem';

const FOUNDING: PlanItem[] = [
  { kind: 'town_hall', schematicQuery: 'mid century town hall', count: 1, required: true },
  { kind: 'plaza', schematicQuery: 'civic plaza', count: 1, required: true },
];

const VILLAGE: PlanItem[] = [
  ...FOUNDING,
  { kind: 'house', schematicQuery: 'mid century suburban house', count: 5, required: true },
  { kind: 'storage', schematicQuery: 'mid century warehouse', count: 1, required: true },
  { kind: 'courthouse', schematicQuery: 'mid century courthouse', count: 1, required: true },
];

const TOWN: PlanItem[] = [
  ...VILLAGE,
  { kind: 'post_office', schematicQuery: 'mid century post office', count: 1, required: true },
  { kind: 'library', schematicQuery: 'mid century public library', count: 1, required: true },
  { kind: 'fire_station', schematicQuery: 'mid century fire station', count: 1, required: true },
  { kind: 'neighborhood_house', schematicQuery: 'mid century suburban house', count: 10, required: true },
];

/**
 * Return the SET of buildings a mid-century-civic town must have at the
 * given tier.
 */
export function getRequiredBuildings(tier: TownTier): PlanItem[] {
  switch (tier) {
    case 'founding':
      return FOUNDING;
    case 'village':
      return VILLAGE;
    case 'town':
      return TOWN;
    default:
      return FOUNDING;
  }
}
