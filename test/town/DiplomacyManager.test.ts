/**
 * DiplomacyManager unit tests (followup).
 *
 * Three coverage areas:
 *   1. trustDelta sign for each kind in TRUST_DELTAS — gift +, raid -, etc.
 *   2. nextStateForTrust hysteresis — verify the bands don't flap when
 *      trust sits inside the neutral hysteresis window.
 *   3. recordInteraction updates the edge — appends to events, refreshes
 *      lastInteractionAt, applies the delta, persists.
 *
 * The DiplomacyManager only needs a tiny TownManager surface
 * (getRelationshipEdge / upsertRelationshipEdge / recordEvent / listRelationshipsFrom).
 * We supply a hand-rolled fake so we don't have to spin up SQLite.
 */
import { describe, it, expect } from 'vitest';
import { DiplomacyManager } from '../../src/town/DiplomacyManager';
import {
  TRUST_DELTAS,
  TRUST_THRESHOLDS,
  trustDelta,
  nextStateForTrust,
} from '../../src/town/diplomacy';
import type { Relationship, InteractionKind } from '../../src/town/Relationship';
import type { TownManager } from '../../src/town/TownManager';

/**
 * Fake TownManager: in-memory map keyed by `${a}|${b}`. Records every
 * recordEvent call so tests can inspect them. The manager only ever calls
 * the 4 methods exposed here, so a partial cast to TownManager is safe.
 */
function makeFakeTownManager() {
  const edges: Map<string, Relationship> = new Map();
  const events: Array<{ townId: string; kind: string; payload?: unknown }> = [];
  const key = (a: string, b: string) => `${a}|${b}`;
  const tm = {
    getRelationshipEdge(a: string, b: string): Relationship | null {
      return edges.get(key(a, b)) ?? null;
    },
    upsertRelationshipEdge(edge: Relationship): boolean {
      edges.set(key(edge.townIdA, edge.townIdB), { ...edge });
      return true;
    },
    listRelationshipsFrom(townId: string): Relationship[] {
      const out: Relationship[] = [];
      for (const r of edges.values()) {
        if (r.townIdA === townId) out.push({ ...r });
      }
      return out;
    },
    listAllRelationships(): Relationship[] {
      return Array.from(edges.values()).map((r) => ({ ...r }));
    },
    recordEvent(input: { townId: string; kind: string; payload?: unknown }) {
      events.push(input);
      return { id: `ev-${events.length}`, ...input };
    },
  } as unknown as TownManager;
  return { tm, edges, events };
}

describe('DiplomacyManager — trustDelta sign per kind', () => {
  it('returns positive deltas for friendly kinds and negative for hostile kinds', () => {
    // Friendly (positive) kinds.
    expect(trustDelta('gift')).toBeGreaterThan(0);
    expect(trustDelta('peace_treaty')).toBeGreaterThan(0);
    expect(trustDelta('peace_overture')).toBeGreaterThan(0);
    // Hostile (negative) kinds.
    expect(trustDelta('border_violation')).toBeLessThan(0);
    expect(trustDelta('raid')).toBeLessThan(0);
    expect(trustDelta('suspicion')).toBeLessThan(0);
    // Unknown kind defaults to 0 — the table is forgiving.
    expect(trustDelta('totally_made_up_kind' as InteractionKind)).toBe(0);
  });

  it('exposes every TRUST_DELTAS entry with a non-zero sign', () => {
    // Spot-check that the table itself is internally consistent.
    for (const [kind, delta] of Object.entries(TRUST_DELTAS)) {
      expect(typeof delta).toBe('number');
      expect(delta).not.toBe(0);
      expect(trustDelta(kind as InteractionKind)).toBe(delta);
    }
  });
});

describe('DiplomacyManager — nextStateForTrust hysteresis', () => {
  it('keeps neutral state stable inside the neutral hysteresis window', () => {
    // Inside (NEUTRAL_TO_RIVAL, NEUTRAL_TO_ALLIED) — no transition.
    const insideNeutral = (TRUST_THRESHOLDS.NEUTRAL_TO_RIVAL + TRUST_THRESHOLDS.NEUTRAL_TO_ALLIED) / 2;
    expect(nextStateForTrust('neutral', insideNeutral)).toBe('neutral');
    expect(nextStateForTrust('neutral', TRUST_THRESHOLDS.NEUTRAL_TO_ALLIED)).toBe('neutral');
    expect(nextStateForTrust('neutral', TRUST_THRESHOLDS.NEUTRAL_TO_RIVAL)).toBe('neutral');
  });

  it('promotes neutral to allied only above NEUTRAL_TO_ALLIED', () => {
    expect(nextStateForTrust('neutral', TRUST_THRESHOLDS.NEUTRAL_TO_ALLIED + 1)).toBe('allied');
    // And degrades neutral to rival only below NEUTRAL_TO_RIVAL.
    expect(nextStateForTrust('neutral', TRUST_THRESHOLDS.NEUTRAL_TO_RIVAL - 1)).toBe('rival');
  });

  it('does not flap allied→neutral when trust drops only into the hysteresis band', () => {
    // ALLIED_TO_NEUTRAL = 50 (default) sits BELOW NEUTRAL_TO_ALLIED = 80,
    // so an allied edge whose trust drops to 60 should remain allied —
    // proving the hysteresis prevents a flip back into neutral.
    const inHysteresis = TRUST_THRESHOLDS.NEUTRAL_TO_ALLIED - 10;
    expect(inHysteresis).toBeGreaterThan(TRUST_THRESHOLDS.ALLIED_TO_NEUTRAL);
    expect(nextStateForTrust('allied', inHysteresis)).toBe('allied');
    // Only when trust falls below ALLIED_TO_NEUTRAL does the edge cool.
    expect(nextStateForTrust('allied', TRUST_THRESHOLDS.ALLIED_TO_NEUTRAL - 1)).toBe('neutral');
  });

  it('does not flap rival→neutral until trust climbs above RIVAL_TO_NEUTRAL', () => {
    // Same hysteresis pattern in reverse — rival stays put inside the band.
    const inBand = TRUST_THRESHOLDS.NEUTRAL_TO_RIVAL + 5;
    expect(nextStateForTrust('rival', inBand)).toBe('rival');
    expect(nextStateForTrust('rival', TRUST_THRESHOLDS.RIVAL_TO_NEUTRAL + 1)).toBe('neutral');
  });
});

describe('DiplomacyManager — recordInteraction', () => {
  it('appends the event, applies trustDelta, and bumps lastInteractionAt', () => {
    const { tm, edges, events } = makeFakeTownManager();
    const dm = new DiplomacyManager(tm);

    // Fresh edge: lazy-created at DEFAULT_TRUST = 50, state 'neutral'.
    const updated = dm.recordInteraction('alpha', 'beta', 'gift');
    expect(updated).not.toBeNull();
    expect(updated!.trust).toBe(50 + TRUST_DELTAS.gift); // +10 → 60
    expect(updated!.events).toHaveLength(1);
    expect(updated!.events[0].kind).toBe('gift');
    expect(updated!.events[0].at).toBeTypeOf('number');
    expect(updated!.lastInteractionAt).toBeTypeOf('number');
    expect(updated!.lastInteractionAt).toBeGreaterThan(0);

    // The fake manager persisted the row.
    const persisted = edges.get('alpha|beta');
    expect(persisted).toBeDefined();
    expect(persisted!.trust).toBe(updated!.trust);

    // recordEvent fires once per interaction with kind 'diplomacy:interaction'.
    expect(events.some((e) => e.kind === 'diplomacy:interaction')).toBe(true);
  });

  it('clamps trust to [0, 100] across multiple hostile events', () => {
    const { tm } = makeFakeTownManager();
    const dm = new DiplomacyManager(tm);

    // Three raids in a row — 50 - 50 - 50 - 50 should clamp to 0, not go
    // negative. (DEFAULT_TRUST=50, raid delta=-50.)
    let r: Relationship | null = dm.recordInteraction('a', 'b', 'raid'); // 50 -> 0
    expect(r!.trust).toBe(0);
    r = dm.recordInteraction('a', 'b', 'raid'); // still 0
    expect(r!.trust).toBe(0);
  });

  it('returns null and is a no-op when self-targeting', () => {
    const { tm } = makeFakeTownManager();
    const dm = new DiplomacyManager(tm);
    expect(dm.recordInteraction('alpha', 'alpha', 'gift')).toBeNull();
  });
});

describe('DiplomacyManager — sustained transitions', () => {
  it('only commits an auto-transition after the sustain window passes', () => {
    const { tm } = makeFakeTownManager();
    // Use sustainTicks=2 so the test is fast but still meaningful.
    const dm = new DiplomacyManager(tm, { sustainTicks: 2 });

    // Push trust over NEUTRAL_TO_ALLIED (80) — single peace_treaty (+30)
    // takes the edge from 50 to 80 which is NOT > 80, so it stays neutral.
    dm.recordInteraction('alpha', 'beta', 'peace_treaty');
    // Next gift (+10) takes it to 90 — now over the threshold.
    dm.recordInteraction('alpha', 'beta', 'gift');

    // First applyAutoTransitions tick: candidate is 'allied' but sustain
    // counter == 1 < 2 → no commit yet.
    dm.applyAutoTransitions('alpha');
    let edge = dm.getRelationship('alpha', 'beta');
    expect(edge!.state).toBe('neutral');

    // Second tick: counter reaches 2 → commit.
    dm.applyAutoTransitions('alpha');
    edge = dm.getRelationship('alpha', 'beta');
    expect(edge!.state).toBe('allied');
  });

  it('admin override via setRelationship commits immediately and aligns trust', () => {
    const { tm } = makeFakeTownManager();
    const dm = new DiplomacyManager(tm);
    // Force from neutral to allied — no sustain, immediate commit.
    const updated = dm.setRelationship('alpha', 'beta', 'allied', { reason: 'test' });
    expect(updated).not.toBeNull();
    expect(updated!.state).toBe('allied');
    // Trust is nudged into the allied band so the next auto-pass doesn't
    // immediately try to undo this.
    expect(updated!.trust).toBeGreaterThanOrEqual(TRUST_THRESHOLDS.NEUTRAL_TO_ALLIED);
  });
});

