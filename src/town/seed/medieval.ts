/**
 * Medieval Communal starter plan.
 *
 * Encodes the minimum set of buildings a medieval-communal town must have at
 * each tier. The Town Brain's build loop compares this list against the
 * `buildings` table and queues any missing required structures.
 *
 * Spec source: TOWN_BUILDER_SPEC.md §6 (style doc) — the medieval preset is
 * cobblestone + oak + dark_oak, steep gabled roofs, civic centerpiece at the
 * town well, watchtowers at the corners.
 *
 * Note on `schematicQuery`: Phase 2 hands this straight through to the
 * schematic source (today: SchematicMatcher keyword search; Phase 4: LLM
 * prompt). The phrasing here is intentionally human-readable.
 */
import type { PlanItem, TownTier } from '../PlanItem';

const FOUNDING: PlanItem[] = [
  { kind: 'town_hall', schematicQuery: 'small medieval town hall', count: 1, required: true },
  { kind: 'well', schematicQuery: 'medieval stone well', count: 1, required: true },
];

const VILLAGE: PlanItem[] = [
  { kind: 'town_hall', schematicQuery: 'small medieval town hall', count: 1, required: true },
  { kind: 'well', schematicQuery: 'medieval stone well', count: 1, required: true },
  { kind: 'house', schematicQuery: 'small medieval house', count: 5, required: true },
  { kind: 'farm', schematicQuery: 'medieval farm plot', count: 1, required: true },
  { kind: 'tavern', schematicQuery: 'medieval tavern', count: 1, required: true },
  { kind: 'storage', schematicQuery: 'medieval storehouse', count: 1, required: true },
];

const TOWN: PlanItem[] = [
  ...VILLAGE,
  { kind: 'guildhall', schematicQuery: 'medieval guildhall', count: 1, required: true },
  { kind: 'walls', schematicQuery: 'cobblestone wall segment', count: 1, required: true },
  { kind: 'blacksmith', schematicQuery: 'medieval blacksmith forge', count: 1, required: true },
  { kind: 'market', schematicQuery: 'medieval market stalls', count: 1, required: true },
  { kind: 'watchtower', schematicQuery: 'medieval watchtower', count: 2, required: true },
];

/**
 * Return the SET of buildings a medieval-communal town must have at the
 * given tier. The brain treats this as the canonical "town plan."
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
