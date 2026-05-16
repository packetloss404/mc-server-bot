/**
 * DiplomacyManager — Phase 7-A.
 *
 * Singleton (per TownManager) that owns the directed-edge relationships table.
 * Three responsibilities:
 *
 *   1. CRUD: getRelationship / setRelationship / list edges for a town.
 *   2. recordInteraction(a, b, kind, payload): appends to the edge's event
 *      list, adjusts trust per `trustDelta(kind)`, refreshes
 *      lastInteractionAt, and emits a `diplomacy:interaction` town event so
 *      the dashboard can render a feed.
 *   3. applyAutoTransitions(): called at the end of each brain tick by
 *      DiplomacyLoop. For each edge it evaluates `nextStateForTrust` against
 *      the current trust; a transition only commits after the candidate
 *      state has been sustained for ≥ SUSTAIN_TICKS consecutive ticks. The
 *      sustain counter is per-edge, in-memory, lost on restart (by design —
 *      a restart conservatively resets the count so we don't flip on the
 *      first post-restart tick).
 *
 * Mutations route through TownManager so the JSONL-fallback story matches
 * the rest of the codebase. setRelationship is the admin-override path
 * (Mayor-gated in api.ts) and immediately commits the new state, bypassing
 * the sustain window.
 *
 * Failure isolation: every public method swallows DB errors and returns a
 * sensible falsy/null value so the brain's runLoopSafe wrapper never crashes
 * a tick on a wedged DB.
 */
import type { TownManager } from './TownManager';
import type {
  InteractionKind,
  Relationship,
  RelationshipState,
} from './Relationship';
import {
  clampTrust,
  DEFAULT_TRUST,
  nextStateForTrust,
  trustDelta,
} from './diplomacy';
import { logger } from '../util/logger';

/**
 * Cap the per-edge `events` array so the JSON blob stays small. Older events
 * fall off the front as new ones are appended.
 */
const RELATIONSHIP_EVENT_LIMIT = 25;

/**
 * Number of consecutive ticks the auto-transition candidate state must hold
 * before DiplomacyManager actually commits it. Kept small for Phase 7 so the
 * loop feels responsive in playtesting.
 */
const DEFAULT_SUSTAIN_TICKS = 3;

export interface DiplomacyManagerOptions {
  /** Override the sustain window — tests use 1 to skip the hysteresis. */
  sustainTicks?: number;
}

/** Public payload for the `diplomacy:interaction` town event. */
export interface InteractionEventPayload {
  fromTownId: string;
  toTownId: string;
  kind: InteractionKind;
  trustBefore: number;
  trustAfter: number;
  state: RelationshipState;
  delta: number;
  payload?: unknown;
}

/** Public payload for the `diplomacy:state_changed` town event. */
export interface StateChangedPayload {
  fromTownId: string;
  toTownId: string;
  previousState: RelationshipState;
  newState: RelationshipState;
  trust: number;
  source: 'auto' | 'admin';
  reason?: string;
}

export class DiplomacyManager {
  private readonly townManager: TownManager;
  private readonly sustainTicks: number;

  /**
   * Per-edge sustain counter for the candidate transition. Keyed by
   * `${a}|${b}|${candidateState}`. The counter increments each tick the
   * candidate stays unchanged; on commit OR when the candidate changes the
   * entry is dropped. Lost on restart.
   */
  private readonly sustainCounters: Map<string, number> = new Map();

  constructor(townManager: TownManager, opts: DiplomacyManagerOptions = {}) {
    this.townManager = townManager;
    this.sustainTicks = opts.sustainTicks ?? DEFAULT_SUSTAIN_TICKS;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  CRUD
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Look up the directed edge `a -> b`. Returns null when no edge has ever
   * been recorded (callers can decide whether to lazy-create at default).
   */
  getRelationship(a: string, b: string): Relationship | null {
    if (a === b) return null;
    try {
      return this.townManager.getRelationshipEdge(a, b);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, a, b }, 'DiplomacyManager.getRelationship: read failed');
      return null;
    }
  }

  /**
   * List every outgoing edge `townId -> *`. Used by the API for
   * GET /api/towns/:id/relationships and by the brain to walk known peers.
   */
  listOutgoing(townId: string): Relationship[] {
    try {
      return this.townManager.listRelationshipsFrom(townId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, townId }, 'DiplomacyManager.listOutgoing: read failed');
      return [];
    }
  }

  /** Full directed graph for every town. Used by GET /api/relationships. */
  listAll(): Relationship[] {
    try {
      return this.townManager.listAllRelationships();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, 'DiplomacyManager.listAll: read failed');
      return [];
    }
  }

  /**
   * Admin override — force the edge into a state. Bypasses the sustain
   * window; commits immediately. Used by the mayor-gated API route. Trust
   * is nudged to the band that matches the new state so the next auto-pass
   * doesn't immediately try to undo the override.
   *
   * Lazy-creates the edge if it didn't exist.
   */
  setRelationship(
    a: string,
    b: string,
    state: RelationshipState,
    opts: { reason?: string } = {},
  ): Relationship | null {
    if (a === b) return null;
    const existing = this.ensureEdge(a, b);
    if (!existing) return null;
    const previousState = existing.state;
    const trust = this.alignTrustForState(existing.trust, state);
    const now = Date.now();
    const updated: Relationship = {
      ...existing,
      state,
      trust,
      lastInteractionAt: now,
    };
    const ok = this.persist(updated);
    if (!ok) return null;
    // Drop any in-flight sustain candidate — the admin just committed.
    this.clearSustainFor(a, b);
    if (previousState !== state) {
      this.emitStateChanged({
        fromTownId: a,
        toTownId: b,
        previousState,
        newState: state,
        trust,
        source: 'admin',
        reason: opts.reason,
      });
    }
    return updated;
  }

  /**
   * Apply a trust delta keyed by interaction kind, append a new
   * RelationshipEvent, and refresh `lastInteractionAt`. Idempotency caveat:
   * callers must dedup at the trigger layer (the brain's diplomacyLoop uses
   * a per-(townIdPair, kind) cooldown). This method itself records every
   * call.
   *
   * Lazy-creates the edge when missing.
   */
  recordInteraction(
    a: string,
    b: string,
    kind: InteractionKind,
    payload?: unknown,
  ): Relationship | null {
    if (a === b) return null;
    const existing = this.ensureEdge(a, b);
    if (!existing) return null;
    const delta = trustDelta(kind);
    const trustBefore = existing.trust;
    const trustAfter = clampTrust(trustBefore + delta);
    const now = Date.now();
    const events = [...(existing.events ?? []), { kind, at: now, payload }].slice(
      -RELATIONSHIP_EVENT_LIMIT,
    );
    const updated: Relationship = {
      ...existing,
      trust: trustAfter,
      lastInteractionAt: now,
      events,
    };
    const ok = this.persist(updated);
    if (!ok) return null;

    // Telemetry: surface every recorded interaction as a town event on the
    // initiator's feed. Severity scales with absolute delta so a raid pops
    // as 'major' while a gift stays 'info'.
    const absDelta = Math.abs(delta);
    const severity = absDelta >= 30 ? 'major' : absDelta >= 10 ? 'minor' : 'info';
    this.townManager.recordEvent({
      townId: a,
      kind: 'diplomacy:interaction',
      severity,
      payload: {
        fromTownId: a,
        toTownId: b,
        kind,
        trustBefore,
        trustAfter,
        state: updated.state,
        delta,
        payload,
      } satisfies InteractionEventPayload,
      highlightScore: 30 + Math.min(40, absDelta),
    });
    return updated;
  }

  /**
   * End-of-tick pass. For each edge owned by `townId` (outgoing), evaluate
   * the candidate next state and commit when it has been sustained for
   * SUSTAIN_TICKS consecutive ticks.
   *
   * The brain's diplomacyLoop calls this once per tick, scoped to its own
   * townId — that keeps the work bounded and means each town only commits
   * transitions for edges it owns.
   */
  applyAutoTransitions(townId: string): void {
    const edges = this.listOutgoing(townId);
    if (edges.length === 0) return;
    for (const edge of edges) {
      try {
        this.applyAutoTransitionForEdge(edge);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          { err: msg, a: edge.townIdA, b: edge.townIdB },
          'DiplomacyManager.applyAutoTransitions: edge threw',
        );
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────────

  private applyAutoTransitionForEdge(edge: Relationship): void {
    const candidate = nextStateForTrust(edge.state, edge.trust);
    if (candidate === edge.state) {
      // No transition pending — drop any stale counter so a brief excursion
      // doesn't carry over.
      this.clearSustainFor(edge.townIdA, edge.townIdB);
      return;
    }
    const key = this.sustainKey(edge.townIdA, edge.townIdB, candidate);
    const prior = this.sustainCounters.get(key) ?? 0;
    const next = prior + 1;
    if (next < this.sustainTicks) {
      this.sustainCounters.set(key, next);
      return;
    }
    // Sustained — commit and clear the counter.
    const previousState = edge.state;
    const updated: Relationship = {
      ...edge,
      state: candidate,
      lastInteractionAt: Date.now(),
    };
    const ok = this.persist(updated);
    if (!ok) return;
    this.clearSustainFor(edge.townIdA, edge.townIdB);
    this.emitStateChanged({
      fromTownId: edge.townIdA,
      toTownId: edge.townIdB,
      previousState,
      newState: candidate,
      trust: edge.trust,
      source: 'auto',
    });
  }

  /** Read-or-create an edge with default starting values. */
  private ensureEdge(a: string, b: string): Relationship | null {
    const existing = this.getRelationship(a, b);
    if (existing) return existing;
    const seed: Relationship = {
      townIdA: a,
      townIdB: b,
      state: 'neutral',
      trust: DEFAULT_TRUST,
      lastInteractionAt: Date.now(),
      events: [],
    };
    const ok = this.persist(seed);
    if (!ok) return null;
    return seed;
  }

  private persist(edge: Relationship): boolean {
    try {
      return this.townManager.upsertRelationshipEdge(edge);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, a: edge.townIdA, b: edge.townIdB },
        'DiplomacyManager.persist: upsert failed',
      );
      return false;
    }
  }

  private emitStateChanged(payload: StateChangedPayload): void {
    const severity = payload.newState === 'rival' ? 'major' : 'minor';
    this.townManager.recordEvent({
      townId: payload.fromTownId,
      kind: 'diplomacy:state_changed',
      severity,
      payload,
      highlightScore: payload.newState === 'allied' || payload.newState === 'rival' ? 70 : 40,
    });
  }

  /**
   * When an admin forces a new state, nudge trust into the matching band so
   * the next auto-pass doesn't immediately push the edge back. We only move
   * to the band boundary — preserving the rest of the trust signal.
   */
  private alignTrustForState(currentTrust: number, state: RelationshipState): number {
    switch (state) {
      case 'allied':
        // Land just above the NEUTRAL_TO_ALLIED threshold so the sustain
        // window won't immediately cool the edge.
        return Math.max(currentTrust, 85);
      case 'rival':
        return Math.min(currentTrust, 20);
      case 'neutral':
      default:
        // Park near the middle of the neutral band.
        return Math.max(35, Math.min(75, currentTrust));
    }
  }

  private sustainKey(a: string, b: string, candidate: RelationshipState): string {
    return `${a}|${b}|${candidate}`;
  }

  private clearSustainFor(a: string, b: string): void {
    const prefix = `${a}|${b}|`;
    for (const key of this.sustainCounters.keys()) {
      if (key.startsWith(prefix)) this.sustainCounters.delete(key);
    }
  }
}
