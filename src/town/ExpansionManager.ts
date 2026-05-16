/**
 * ExpansionManager — Phase 5-B.
 *
 * Owns the *self-expansion* loop: when a town outgrows itself the brain
 * proposes a child town ~256 blocks from the parent capital and (subject
 * to the daily cap + first-child auto-approval rules) calls
 * `TownManager.createTown` with `parentTownId` set.
 *
 * Eligibility rules (spec §5):
 *   - parent must be `tier === 'town'`.
 *   - parent must have `population >= populationTarget` (or, when
 *     populationTarget is null, ≥ the default Phase-5 ceiling).
 *   - at most ONE child per tick (caller's responsibility — `proposeExpansion`
 *     short-circuits if it already found a proposal).
 *   - a daily expansion-proposal cap (default 1). Counter is in-memory for
 *     Phase 5; persistence is a follow-up.
 *   - first child is auto-approved (executeProposal proceeds). Subsequent
 *     proposals stay pending and emit `expansion:pending_approval`; the
 *     actual approval API lands in Phase 6.
 *
 * Phase-5 inheritance: the child inherits the parent's `styleSeed`. Phase 7
 * adds alliance/divergence behavior (style drift, rival/ally outcomes).
 *
 * Failure isolation: the brain wraps every call in `runLoopSafe`, but the
 * manager itself never throws in the proposal path — it returns `null` and
 * logs.
 */
import type { TownManager } from './TownManager';
import type { Town, Vec3 } from './Town';
import type { StyleSeed } from './StyleDoc';
import { logger } from '../util/logger';

/** Distance from parent capital to child capital, in blocks. */
const CHILD_OFFSET_BLOCKS = 256;

/** Population-target floor: if a parent has no explicit populationTarget,
 *  use this as the minimum it must reach before expansion is allowed. */
const DEFAULT_EXPANSION_POPULATION_THRESHOLD = 8;

/** Default daily proposal cap when none provided. */
const DEFAULT_DAILY_PROPOSAL_CAP = 1;

export type CardinalDirection = 'North' | 'East' | 'South' | 'West';

const CARDINAL_OFFSETS: Record<CardinalDirection, { dx: number; dz: number }> = {
  North: { dx: 0, dz: -1 },
  East: { dx: 1, dz: 0 },
  South: { dx: 0, dz: 1 },
  West: { dx: -1, dz: 0 },
};

export interface ChildProposal {
  parentTownId: string;
  parentTownName: string;
  childName: string;
  childCapital: Vec3;
  styleSeed: StyleSeed;
  direction: CardinalDirection;
  /** True iff the proposal can be auto-executed without admin approval. */
  autoApprove: boolean;
}

export interface ExecuteResult {
  childTown: Town | null;
  ok: boolean;
  reason?: string;
}

export interface ExpansionManagerOptions {
  /** Override the per-day proposal cap (default 1). */
  dailyProposalCap?: number;
  /** Override the seed RNG — used by tests for deterministic direction choice. */
  rng?: () => number;
  /** Override the offset distance — used by tests to shrink coords. */
  offsetBlocks?: number;
}

export class ExpansionManager {
  private readonly townManager: TownManager;
  private readonly dailyProposalCap: number;
  private readonly rng: () => number;
  private readonly offsetBlocks: number;

  /** UTC yyyy-mm-dd → proposals issued that day. In-memory only for Phase 5. */
  private readonly dailyProposalCount: Map<string, number> = new Map();

  /**
   * Tracks which parent towns have logged a `pending_approval` event for
   * the current proposal — keeps repeated ticks from spamming the events
   * table. Cleared per-day with the proposal counter.
   */
  private readonly pendingApprovalLogged: Set<string> = new Set();

  constructor(townManager: TownManager, opts: ExpansionManagerOptions = {}) {
    this.townManager = townManager;
    this.dailyProposalCap = opts.dailyProposalCap ?? DEFAULT_DAILY_PROPOSAL_CAP;
    this.rng = opts.rng ?? Math.random;
    this.offsetBlocks = opts.offsetBlocks ?? CHILD_OFFSET_BLOCKS;
  }

  /**
   * Decide whether a parent town should spawn a child this tick, and
   * return the proposal when eligible. Returns null when:
   *   - parent isn't `town` tier yet,
   *   - parent hasn't hit its populationTarget,
   *   - the daily cap is already exhausted,
   *   - the parent already has a child AND a second proposal is pending
   *     (we record `expansion:pending_approval` once and bail; the actual
   *     approval flow ships in Phase 6).
   */
  proposeExpansion(parent: Town): ChildProposal | null {
    if (parent.tier !== 'town') return null;
    if (parent.status !== 'active') return null;
    if (!parent.capital) return null;

    const population = this.currentPopulation(parent.id);
    const target = parent.populationTarget ?? DEFAULT_EXPANSION_POPULATION_THRESHOLD;
    if (population < target) return null;

    // Daily cap.
    const dayKey = this.todayKey();
    const proposalsToday = this.dailyProposalCount.get(dayKey) ?? 0;
    if (proposalsToday >= this.dailyProposalCap) return null;

    const existingChildren = this.townManager.getChildTowns(parent.id);

    // Build the proposal up-front so we can decide auto-approve below.
    const direction = this.pickCardinalDirection();
    const childCapital = this.pickChildCapital(parent.capital, direction);
    const childName = `${parent.name}-${direction}`;
    const styleSeed = (parent.styleSeed ?? 'medieval-communal') as StyleSeed;

    if (existingChildren.length > 0) {
      // Already has at least one child — second proposal needs approval.
      if (!this.pendingApprovalLogged.has(parent.id)) {
        this.pendingApprovalLogged.add(parent.id);
        this.townManager.recordEvent({
          townId: parent.id,
          kind: 'expansion:pending_approval',
          severity: 'minor',
          payload: {
            proposedChildName: childName,
            direction,
            childCapital,
            reason: 'awaiting Phase 6 approval flow',
          },
          highlightScore: 40,
        });
      }
      return null;
    }

    const proposal: ChildProposal = {
      parentTownId: parent.id,
      parentTownName: parent.name,
      childName,
      childCapital,
      styleSeed,
      direction,
      autoApprove: true,
    };

    // Reserve the daily slot the moment we propose so a long-running tick
    // can't double-spawn.
    this.dailyProposalCount.set(dayKey, proposalsToday + 1);

    this.townManager.recordEvent({
      townId: parent.id,
      kind: 'expansion:proposed',
      severity: 'major',
      payload: {
        childName,
        direction,
        childCapital,
        styleSeed,
        autoApprove: true,
      },
      highlightScore: 75,
    });
    logger.info(
      { parentTownId: parent.id, childName, direction, childCapital },
      'ExpansionManager: child town proposed',
    );

    return proposal;
  }

  /**
   * Materialize a proposal — create the child town via TownManager. Emits
   * `expansion:founded` on success.
   */
  executeProposal(proposal: ChildProposal): ExecuteResult {
    if (!proposal.autoApprove) {
      return { childTown: null, ok: false, reason: 'requires approval' };
    }
    try {
      const result = this.townManager.createTown({
        name: proposal.childName,
        capital: proposal.childCapital,
        stylePreset: proposal.styleSeed,
        parentTownId: proposal.parentTownId,
      });
      this.townManager.recordEvent({
        townId: proposal.parentTownId,
        kind: 'expansion:founded',
        severity: 'major',
        payload: {
          childTownId: result.town.id,
          childName: result.town.name,
          direction: proposal.direction,
          childCapital: proposal.childCapital,
          styleSeed: proposal.styleSeed,
        },
        highlightScore: 90,
      });
      // Mirror the founded event on the child too so its own events feed
      // captures the lineage.
      this.townManager.recordEvent({
        townId: result.town.id,
        kind: 'expansion:founded',
        severity: 'major',
        payload: {
          parentTownId: proposal.parentTownId,
          parentTownName: proposal.parentTownName,
          direction: proposal.direction,
          styleSeed: proposal.styleSeed,
        },
        highlightScore: 90,
      });
      logger.info(
        {
          parentTownId: proposal.parentTownId,
          childTownId: result.town.id,
          childName: result.town.name,
        },
        'ExpansionManager: child town founded',
      );
      return { childTown: result.town, ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, parentTownId: proposal.parentTownId, childName: proposal.childName },
        'ExpansionManager: executeProposal failed',
      );
      return { childTown: null, ok: false, reason: msg };
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────────

  private currentPopulation(townId: string): number {
    const residents = this.townManager.listResidents(townId);
    return residents.filter((r) => r.status === 'alive' || r.status == null).length;
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private pickCardinalDirection(): CardinalDirection {
    const dirs: CardinalDirection[] = ['North', 'East', 'South', 'West'];
    return dirs[Math.floor(this.rng() * dirs.length)] ?? 'North';
  }

  private pickChildCapital(parentCapital: Vec3, direction: CardinalDirection): Vec3 {
    const { dx, dz } = CARDINAL_OFFSETS[direction];
    return {
      x: parentCapital.x + dx * this.offsetBlocks,
      y: parentCapital.y,
      z: parentCapital.z + dz * this.offsetBlocks,
    };
  }

  /** Reset the daily counter — exposed for tests + the eventual cron purge. */
  resetDailyCap(): void {
    this.dailyProposalCount.clear();
    this.pendingApprovalLogged.clear();
  }

  /** Snapshot for the dashboard / API debug surface. */
  getStatus(): { proposalsToday: number; dailyCap: number; dayKey: string } {
    const dayKey = this.todayKey();
    return {
      proposalsToday: this.dailyProposalCount.get(dayKey) ?? 0,
      dailyCap: this.dailyProposalCap,
      dayKey,
    };
  }
}
