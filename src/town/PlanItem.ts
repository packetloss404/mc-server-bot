/**
 * Town plan item — the unit of "the town should have one of these" used by
 * the style-seed plans (`seed/medieval.ts`, `seed/midcentury.ts`) and consumed
 * by TownBrain's build loop.
 *
 * The schema is deliberately tiny so the seed files stay readable. Phase 4
 * will extend `schematicQuery` to be either a SchematicMatcher prompt OR an
 * LLM design prompt; for Phase 2 it's just a keyword string handed straight
 * to BuildCoordinator (which today picks any schematic — Phase 4 will route
 * through SchematicMatcher).
 */
export type TownTier = 'founding' | 'village' | 'town';

export interface PlanItem {
  /**
   * The building "kind" — a stable identifier the brain uses for de-duping
   * (don't queue a second town_hall if one is planned). Examples:
   *   'town_hall' | 'house' | 'farm' | 'storage' | 'tavern' | 'guildhall'
   *   'well' | 'walls' | 'blacksmith' | 'market' | 'watchtower'
   *   'plaza' | 'courthouse' | 'post_office' | 'library' | 'fire_station'
   */
  kind: string;
  /**
   * What to ask the schematic source for. Today this is a SchematicMatcher
   * keyword query like 'small medieval house'. Phase 4 swaps this to LLM
   * design prompts but the field shape stays.
   */
  schematicQuery: string;
  /** How many instances at this tier (1 town hall, 5 houses, etc.). */
  count: number;
  /** When true, missing this building blocks tier-up. */
  required: boolean;
}
