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
import fs from 'fs';
import path from 'path';
import type { TownManager } from './TownManager';
import type { Town, Vec3 } from './Town';
import type { StyleSeed } from './StyleDoc';
import type { ApprovalManager, HandlerDescriptor } from './ApprovalManager';
import { logger } from '../util/logger';
import { atomicWriteJsonSync } from '../util/atomicWrite';

/**
 * Phase 8-followup #57 — descriptor kind for expansion handlers. Persisted
 * verbatim into approvals.handler_descriptor_json so the brain can replay
 * the resolveOnce hookup on restart even when this in-process registry is
 * empty.
 */
const EXPANSION_HANDLER_KIND = 'expansion';

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
  /**
   * Phase 6-B — optional ApprovalManager. When present, second+ child
   * proposals open an approval row and register a resolveOnce handler that
   * calls executeProposal once approved. Without it the legacy Phase 5
   * behaviour is preserved (just emit pending_approval and bail).
   */
  approvalManager?: ApprovalManager;
}

export class ExpansionManager {
  private readonly townManager: TownManager;
  private readonly dailyProposalCap: number;
  private readonly rng: () => number;
  private readonly offsetBlocks: number;
  /** Phase 6-B — set by the brain after construction (avoids ctor cycles). */
  private approvalManager: ApprovalManager | null;

  /**
   * UTC yyyy-mm-dd → proposals issued that day. Followup #51 — also
   * persisted to `data/towns/<parentTownId>/expansion.json` so a restart
   * doesn't reset the daily cap and allow a second child-town proposal
   * within the same day.
   */
  private readonly dailyProposalCount: Map<string, number> = new Map();

  /**
   * Followup #51 — parent town id whose counter is persisted on disk.
   * Lazily learned on first proposeExpansion call (the brain doesn't pass
   * the townId at construction; ExpansionManager is per-town because each
   * TownBrain owns one). null means we haven't seen any parent yet, so
   * nothing's loaded from disk and writes are deferred.
   */
  private persistTownId: string | null = null;
  /** True once we've attempted (success or failure) the on-disk load. */
  private hydrated = false;

  /**
   * Tracks which parent towns have logged a `pending_approval` event for
   * the current proposal — keeps repeated ticks from spamming the events
   * table. Cleared per-day with the proposal counter.
   */
  private readonly pendingApprovalLogged: Set<string> = new Set();
  /**
   * Tracks which parent towns already have an open approval row pending so
   * repeated ticks don't keep stuffing duplicate rows into the queue while
   * the operator hasn't decided yet. Cleared per-day with the proposal counter.
   */
  private readonly pendingApprovalIds: Map<string, string> = new Map();

  constructor(townManager: TownManager, opts: ExpansionManagerOptions = {}) {
    this.townManager = townManager;
    this.dailyProposalCap = opts.dailyProposalCap ?? DEFAULT_DAILY_PROPOSAL_CAP;
    this.rng = opts.rng ?? Math.random;
    this.offsetBlocks = opts.offsetBlocks ?? CHILD_OFFSET_BLOCKS;
    this.approvalManager = opts.approvalManager ?? null;
  }

  /**
   * Phase 6-B — late-binding setter so the brain can wire the approval
   * manager after constructing both. ApprovalManager is owned by the brain;
   * passing it here preserves the existing constructor signature.
   *
   * Phase 8-followup #57 — also registers the 'expansion' rehydrator so the
   * ApprovalManager's boot-time rehydrate() can re-attach the resolveOnce
   * hook for any open expansion-approval row persisted before this process
   * started. Registration is idempotent on ApprovalManager's side.
   */
  setApprovalManager(approvalManager: ApprovalManager | null): void {
    this.approvalManager = approvalManager;
    if (approvalManager) {
      approvalManager.registerKindHandler(EXPANSION_HANDLER_KIND, (approvalId, descriptor) =>
        this.rehydrateHandler(approvalId, descriptor),
      );
    }
  }

  /**
   * Phase 8-followup #57 — replay the resolveOnce + onSettled hooks for a
   * persisted approval row. Called by ApprovalManager during rehydrate(): we
   * reconstruct the same `executable` proposal the live proposeExpansion()
   * path would have built and re-register the same callbacks. Failure-
   * isolated: a bad descriptor logs and returns rather than throwing into
   * the rehydrate loop.
   */
  async rehydrateHandler(approvalId: string, descriptor: HandlerDescriptor): Promise<void> {
    if (!this.approvalManager) return;
    const payload = descriptor.payload as ChildProposal | null | undefined;
    if (!payload || typeof payload !== 'object' || typeof payload.parentTownId !== 'string') {
      logger.warn(
        { approvalId, kind: descriptor.kind, target: descriptor.target },
        'ExpansionManager.rehydrateHandler: descriptor payload is not a ChildProposal; skipping',
      );
      return;
    }
    // Re-bind the per-parent tracker so a denied/expired row still clears
    // pendingApprovalIds (same as the live path).
    this.pendingApprovalIds.set(payload.parentTownId, approvalId);
    const executable: ChildProposal = { ...payload, autoApprove: true };
    await this.approvalManager.resolveOnce(approvalId, async () => {
      this.executeProposal(executable);
    });
    await this.approvalManager.onSettled(approvalId, async () => {
      this.pendingApprovalIds.delete(payload.parentTownId);
    });
    logger.info(
      { approvalId, parentTownId: payload.parentTownId, childName: payload.childName },
      'ExpansionManager.rehydrateHandler: re-registered expansion approval',
    );
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

    // Followup #51 — hydrate counter from disk the first time we see this
    // parent. The brain doesn't pass the townId at construction (D's lane,
    // out of scope for this followup), so we late-bind it here once the
    // first proposeExpansion call surfaces a parent town.
    this.hydrateForTownIfNeeded(parent.id);

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
      const pendingProposal: ChildProposal = {
        parentTownId: parent.id,
        parentTownName: parent.name,
        childName,
        childCapital,
        styleSeed,
        direction,
        autoApprove: false,
      };
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
            reason: 'awaiting approval (Phase 6 queue)',
          },
          highlightScore: 40,
        });
      }
      // Phase 6-B — open an approval row + register the resolve hook so an
      // 'approved' decision actually founds the child. Skipped when no
      // approval manager has been wired (legacy Phase 5 tests).
      //
      // Phase 8-followup #57 — also persist a HandlerDescriptor on the row
      // so a restart between create and approve can re-register the same
      // resolveOnce hook via ExpansionManager.rehydrateHandler.
      if (this.approvalManager && !this.pendingApprovalIds.has(parent.id)) {
        const descriptor: HandlerDescriptor = {
          kind: EXPANSION_HANDLER_KIND,
          payload: pendingProposal,
          target: parent.id,
        };
        const approval = this.approvalManager.createApproval(
          {
            townId: parent.id,
            kind: 'expansion',
            payload: pendingProposal,
          },
          descriptor,
        );
        if (approval) {
          this.pendingApprovalIds.set(parent.id, approval.id);
          // Force-promote autoApprove to true at execution time so
          // executeProposal doesn't reject the resolved payload as still
          // requiring approval — it has already been approved by the queue.
          const executable: ChildProposal = { ...pendingProposal, autoApprove: true };
          void this.approvalManager.resolveOnce(
            approval.id,
            async () => {
              // Always re-execute via the manager's own method so the
              // event/chronicle/founded-events pipeline fires identically to
              // the auto-approval path.
              this.executeProposal(executable);
            },
            descriptor,
          );
          // Clear pendingApprovalIds on ANY terminal status so a
          // denied/expired row doesn't strand the parent until UTC
          // midnight. resolveOnce above only fires on 'approved'.
          void this.approvalManager.onSettled(approval.id, async () => {
            this.pendingApprovalIds.delete(parent.id);
          });
        }
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
    // Followup #51 — persist immediately so a crash between propose and
    // execute still has the slot recorded.
    this.persistCounter();

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
    this.pendingApprovalIds.clear();
    this.persistCounter();
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

  // ──────────────────────────────────────────────────────────────────────
  //  Followup #51 — daily proposal counter persistence
  //
  //  File layout: `data/towns/<parentTownId>/expansion.json`
  //    {
  //      "dailyProposalCount": { "2026-05-15": 1, "2026-05-14": 1 },
  //      "updatedAt": 1747315200000
  //    }
  //
  //  Failure-isolated: load/save errors log a warn and continue with
  //  in-memory state — a wedged disk never breaks the expansion loop.
  // ──────────────────────────────────────────────────────────────────────

  /** Resolve the on-disk path for the counter file. Returns null when no town bound. */
  private getPersistFile(): string | null {
    if (!this.persistTownId) return null;
    const dataDir = this.townManager.getDataDir?.() ?? path.join(process.cwd(), 'data');
    return path.join(dataDir, 'towns', this.persistTownId, 'expansion.json');
  }

  /**
   * Late-bind the parent town id and hydrate the in-memory counter from
   * disk on the first proposeExpansion call. Subsequent calls are no-ops
   * (the counter is already in sync). If the parent id changes mid-flight
   * (shouldn't happen — ExpansionManager is per-town) we keep the first
   * id we saw to avoid swapping persistence files.
   */
  private hydrateForTownIfNeeded(townId: string): void {
    if (this.hydrated) return;
    this.persistTownId = townId;
    this.hydrated = true;
    const file = this.getPersistFile();
    if (!file) return;
    try {
      if (!fs.existsSync(file)) return;
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as { dailyProposalCount?: Record<string, number> };
      const counts = parsed?.dailyProposalCount;
      if (counts && typeof counts === 'object') {
        for (const [day, n] of Object.entries(counts)) {
          if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
            this.dailyProposalCount.set(day, Math.floor(n));
          }
        }
      }
      logger.debug(
        { townId, file, entries: this.dailyProposalCount.size },
        'ExpansionManager: hydrated daily proposal counter from disk',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, townId, file },
        'ExpansionManager: failed to hydrate daily counter; using in-memory state',
      );
    }
  }

  /**
   * Atomically persist the counter to disk. No-op when no parent town has
   * been bound yet (i.e. proposeExpansion has never been called). Failure
   * logs a warn and continues — the in-memory state is still authoritative
   * until the next successful write.
   */
  private persistCounter(): void {
    const file = this.getPersistFile();
    if (!file) return;
    try {
      const payload = {
        dailyProposalCount: Object.fromEntries(this.dailyProposalCount.entries()),
        updatedAt: Date.now(),
      };
      atomicWriteJsonSync(file, payload);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, file },
        'ExpansionManager: failed to persist daily counter (continuing in-memory)',
      );
    }
  }
}
