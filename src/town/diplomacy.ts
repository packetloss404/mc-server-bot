/**
 * diplomacy — Phase 7-A pure heuristics.
 *
 * Two responsibilities, both deliberately stateless and free of TownManager /
 * DB references so they can be unit-tested without spinning up SQLite:
 *
 *   1. trustDelta(kind)            — how much to push the trust score per
 *                                    interaction kind.
 *   2. nextStateForTrust(s, trust) — given the current state + the new trust
 *                                    score, decide whether to auto-transition.
 *
 * Auto-transitions are NOT instantaneous — DiplomacyManager only promotes on
 * a state that has been sustained for ≥ N consecutive ticks (default 3),
 * preventing a single big event from flipping an edge. That sustain check is
 * orchestrated in the manager; this file just exposes the threshold table.
 *
 * Both functions stay data-driven (no switch on a million kinds) so adding a
 * new InteractionKind only needs an entry in TRUST_DELTAS — see
 * Relationship.ts for the canonical kind list.
 */
import type { InteractionKind, RelationshipState } from './Relationship';

/**
 * Per-interaction-kind trust adjustments. Positive entries push toward
 * 'allied', negative entries push toward 'rival'. Unknown kinds default to 0
 * (no-op) — this keeps unknown payloads cheap and avoids accidental flips
 * when a future caller invents a new kind without updating the table.
 */
export const TRUST_DELTAS: Record<string, number> = {
  gift: 10,
  peace_treaty: 30,
  peace_overture: 5,
  border_violation: -20,
  raid: -50,
  suspicion: -10,
};

/**
 * Trust thresholds for auto-transitions. The DiplomacyManager only acts when
 * the current trust value has been on the same side of the threshold for ≥ N
 * consecutive brain ticks (default N=3).
 *
 *  - trust > NEUTRAL_TO_ALLIED   → 'neutral' may promote to 'allied'
 *  - trust > RIVAL_TO_NEUTRAL    → 'rival' may relax to 'neutral'
 *  - trust < ALLIED_TO_NEUTRAL   → 'allied' may cool to 'neutral'
 *  - trust < NEUTRAL_TO_RIVAL    → 'neutral' may sour to 'rival'
 *
 * The bands deliberately leave hysteresis windows (e.g. neutral 40..80) so an
 * edge bouncing around the boundary doesn't oscillate.
 */
export const TRUST_THRESHOLDS = {
  NEUTRAL_TO_ALLIED: 80,
  RIVAL_TO_NEUTRAL: 60,
  ALLIED_TO_NEUTRAL: 50,
  NEUTRAL_TO_RIVAL: 25,
} as const;

/** Trust score range. Inputs to recordInteraction get clamped to this band. */
export const TRUST_MIN = 0;
export const TRUST_MAX = 100;

/** Brand-new relationships start here so a single hostile event isn't enough
 *  to immediately drop the edge into 'rival'. */
export const DEFAULT_TRUST = 50;

/**
 * Look up the trust delta for an interaction kind. Returns 0 for unknown
 * kinds (no-op). The Record indexer is forgiving so callers can pass the
 * looser `InteractionKind` type without runtime narrowing.
 */
export function trustDelta(kind: InteractionKind): number {
  const delta = TRUST_DELTAS[kind];
  return typeof delta === 'number' ? delta : 0;
}

/**
 * Given the current relationship state + the latest trust score, return the
 * state the edge *would* move to if the trust band held steady. The
 * DiplomacyManager calls this every tick and only commits the transition
 * after the sustain window passes.
 *
 * Returns the input state when no transition is warranted — callers can
 * compare identity (`next === current`) to detect stability.
 */
export function nextStateForTrust(
  current: RelationshipState,
  trust: number,
): RelationshipState {
  switch (current) {
    case 'allied':
      if (trust < TRUST_THRESHOLDS.ALLIED_TO_NEUTRAL) return 'neutral';
      return 'allied';
    case 'rival':
      if (trust > TRUST_THRESHOLDS.RIVAL_TO_NEUTRAL) return 'neutral';
      return 'rival';
    case 'neutral':
    default:
      if (trust > TRUST_THRESHOLDS.NEUTRAL_TO_ALLIED) return 'allied';
      if (trust < TRUST_THRESHOLDS.NEUTRAL_TO_RIVAL) return 'rival';
      return 'neutral';
  }
}

/** Clamp a trust score to the [TRUST_MIN, TRUST_MAX] band. */
export function clampTrust(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TRUST;
  return Math.max(TRUST_MIN, Math.min(TRUST_MAX, Math.round(value)));
}
