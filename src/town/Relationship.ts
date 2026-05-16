/**
 * Relationship — Phase 7-A.
 *
 * The directed-pair relationship model that supersedes the legacy
 * `towns.alliance_state` global column. Every (townId_a -> townId_b) edge
 * carries a state, a trust score (0..100), the last time something happened on
 * the edge, and a short rolling list of recent diplomatic events so the brain
 * + dashboard can reason about why two towns are where they are.
 *
 * The legacy `alliance_state` column on the towns table is left in place for
 * back-compat (Phase 5/6 readers may still consult it), but new diplomacy
 * logic lives on this edge.
 *
 * Type-only module — no behaviour. See DiplomacyManager for state mutation
 * and diplomacy.ts for the pure heuristics (trust deltas + transitions).
 */

/**
 * The current diplomatic posture of one town toward another. Directed edges:
 * A -> B may be 'allied' while B -> A is 'rival'. Auto-transitions and
 * defaults always start at 'neutral'.
 */
export type RelationshipState = 'allied' | 'rival' | 'neutral';

/**
 * The catalogue of diplomatic interaction kinds Phase 7 understands. Adding a
 * new kind is two steps: append here, then assign a `trustDelta(kind)` in
 * diplomacy.ts.
 *
 *  - gift              — A gave B a notable resource bundle (trust up)
 *  - peace_treaty      — A and B signed a non-aggression pact (trust up big)
 *  - peace_overture    — A's mayor decree mentioned B by name (small trust up)
 *  - border_violation  — A's expansion lands within 100 blocks of B's capital
 *  - raid              — A's bots attacked B's residents
 *  - suspicion         — Memorial Park monument for a lost_bot near B's bots
 */
export type InteractionKind =
  | 'gift'
  | 'peace_treaty'
  | 'peace_overture'
  | 'border_violation'
  | 'raid'
  | 'suspicion'
  | string;

/**
 * A single recorded diplomatic event on a relationship edge. Kept lean — the
 * payload is whatever context the trigger captured (e.g. `{ distance: 73 }`
 * for a border violation). Older events drop off the relationship as new ones
 * are recorded (see RELATIONSHIP_EVENT_LIMIT in DiplomacyManager).
 */
export interface RelationshipEvent {
  kind: InteractionKind;
  at: number;
  payload?: unknown;
}

/**
 * Directed edge: townIdA's posture toward townIdB. `trust` is bounded to
 * [0..100] by DiplomacyManager.recordInteraction. `events` is the most
 * recent N items, newest-last (so the tail is the freshest interaction).
 */
export interface Relationship {
  townIdA: string;
  townIdB: string;
  state: RelationshipState;
  trust: number;
  lastInteractionAt: number;
  events: RelationshipEvent[];
}
