/**
 * ApprovalManager — Phase 6-B.
 *
 * Owns the lifecycle of approval rows backing every gated action in the town
 * builder. Phase 5's ExpansionManager emits `expansion:pending_approval`
 * events when a parent town tries to spawn a 2nd child; this manager turns
 * that signal into a queued row that:
 *
 *   1. Mayor-direct: an admin/mayor approves or denies via API.
 *   2. Resident vote: each alive resident's brain casts yes/no via the
 *      Phase-6 heuristic (see VoteHeuristic.ts). After `expiresAt` the
 *      brain's approvalLoop tallies majority and resolves the row.
 *
 * The chosen mode comes from `town.config.approvalMode` and is read on every
 * `tally()` so an operator can flip the toggle live and the next tick honours
 * it. Default mode is 'mayor'.
 *
 * Resolution side channel: callers (e.g. ExpansionManager) register a
 * `resolveOnce(approvalId, handler)` callback at create time; when the row
 * settles to 'approved' the handler fires once, with the original payload as
 * its argument. Denied/expired rows do NOT fire the handler — the proposer
 * is expected to require an explicit re-issue.
 *
 * In-memory caveats:
 *   - The `resolveOnce` registry lives in-process. A restart loses every
 *     pending handler, leaving rows in 'open' status until the brain's next
 *     tally tries to resolve them. The original proposer (e.g.
 *     ExpansionManager) does NOT retry; an operator must re-issue. Tracked
 *     as a Phase 8 followup (durable handler registry).
 *
 * Failure isolation: every public method swallows DB errors and returns a
 * sensible falsy/null value so the brain's runLoopSafe wrapper never crashes
 * a tick on a wedged DB.
 */
import type { TownManager } from './TownManager';
import type { Approval, ApprovalKind, ApprovalMode, ApprovalStatus, ApprovalVotes } from './Approval';
import { voteFor } from './VoteHeuristic';
import { logger } from '../util/logger';

/** Default vote window (real-time milliseconds) when caller doesn't specify. */
const DEFAULT_VOTE_WINDOW_MS = 90_000;

export interface CreateApprovalInput {
  townId: string;
  kind: ApprovalKind | string;
  /** Original proposal payload — replayed verbatim on approval. */
  payload: unknown;
  /** Override the vote window (ms). Defaults to 90s. */
  openFor?: number;
}

/**
 * Handler invoked once when an approval resolves to 'approved'.
 * Payload is the same blob originally passed to createApproval.
 */
export type ApprovalResolveHandler = (payload: unknown) => Promise<void> | void;

/**
 * Fires once when an approval reaches ANY terminal state (approved | denied |
 * expired). The proposer registers this to clean up its own per-approval
 * tracking (e.g. ExpansionManager.pendingApprovalIds) so a denied/expired row
 * doesn't strand the parent town until the next UTC midnight.
 */
export type ApprovalSettledHandler = (approval: Approval) => Promise<void> | void;

export class ApprovalManager {
  private readonly townManager: TownManager;
  /**
   * Pending in-flight handlers. Keyed by approvalId. Cleared once invoked
   * (handler fires at most once per approval). Lost on restart.
   */
  private readonly pendingHandlers: Map<string, ApprovalResolveHandler> = new Map();
  private readonly settledHandlers: Map<string, ApprovalSettledHandler> = new Map();
  /**
   * Tracks approvals whose 'created' / 'expired' / etc. lifecycle event has
   * already fired during this process's lifetime — purely cosmetic, prevents
   * the brain's tally loop from spamming events on repeated ticks.
   */
  private readonly emittedLifecycleEvents: Set<string> = new Set();

  constructor(townManager: TownManager) {
    this.townManager = townManager;
  }

  /**
   * Insert a new approval row. Caller may follow up with `resolveOnce` to
   * register the handler that fires when the approval is approved.
   */
  createApproval(input: CreateApprovalInput): Approval | null {
    const now = Date.now();
    const expiresAt = now + (input.openFor ?? DEFAULT_VOTE_WINDOW_MS);
    try {
      const inserted = this.townManager.insertApproval({
        townId: input.townId,
        kind: input.kind,
        payload: input.payload,
        createdAt: now,
        expiresAt,
        status: 'open',
      });
      if (!inserted) return null;
      const lifecycleKey = `${inserted.id}:created`;
      if (!this.emittedLifecycleEvents.has(lifecycleKey)) {
        this.emittedLifecycleEvents.add(lifecycleKey);
        this.townManager.recordEvent({
          townId: input.townId,
          kind: 'approval:created',
          severity: 'minor',
          payload: {
            approvalId: inserted.id,
            kind: input.kind,
            expiresAt,
            mode: this.modeFor(input.townId),
          },
          highlightScore: 35,
        });
      }
      return inserted;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, townId: input.townId, kind: input.kind },
        'ApprovalManager.createApproval: insert failed',
      );
      return null;
    }
  }

  /**
   * Cast (or update) a single bot's vote on an open approval. Returns true
   * when the vote was recorded. Idempotent — re-casting overwrites the prior
   * choice for that bot.
   */
  castVote(approvalId: string, voterBotName: string, choice: 'yes' | 'no'): boolean {
    const approval = this.townManager.getApproval(approvalId);
    if (!approval) return false;
    if (approval.status !== 'open') return false;
    const votes: ApprovalVotes = {
      yes: [...(approval.votes?.yes ?? [])],
      no: [...(approval.votes?.no ?? [])],
    };
    // Remove from any existing bucket first so the vote moves cleanly.
    votes.yes = votes.yes.filter((b) => b !== voterBotName);
    votes.no = votes.no.filter((b) => b !== voterBotName);
    votes[choice].push(voterBotName);
    return this.townManager.updateApproval(approvalId, { votes });
  }

  /**
   * Mayor-direct decision. Marks the approval approved/denied immediately and
   * fires the resolveOnce handler when approved. No vote tallying happens
   * here; a mayor decision overrides any in-flight votes.
   */
  async mayorDecide(approvalId: string, choice: 'approved' | 'denied'): Promise<Approval | null> {
    const approval = this.townManager.getApproval(approvalId);
    if (!approval) return null;
    if (approval.status !== 'open') return approval;
    const ok = this.townManager.updateApproval(approvalId, {
      status: choice,
      mayorDecision: choice,
    });
    if (!ok) return null;
    const updated = this.townManager.getApproval(approvalId) ?? approval;
    this.townManager.recordEvent({
      townId: approval.townId,
      kind: choice === 'approved' ? 'approval:approved' : 'approval:denied',
      severity: 'major',
      payload: {
        approvalId,
        kind: approval.kind,
        decidedBy: 'mayor',
      },
      highlightScore: choice === 'approved' ? 70 : 50,
    });
    if (choice === 'approved') {
      await this.fireResolveHandler(updated);
    } else {
      // Denied — drop the handler so a later restart can't fire it.
      this.pendingHandlers.delete(approvalId);
    }
    await this.fireSettledHandler(updated);
    return updated;
  }

  /**
   * Tally a single open approval. Called by the brain's approvalLoop on every
   * tick. Resolves the row when:
   *   - Mode is 'mayor' and `expiresAt` has passed without a mayor decision
   *     (status flips to 'expired').
   *   - Mode is 'vote' and `expiresAt` has passed (majority decides; ties
   *     and zero-vote rows go to 'denied').
   *
   * Returns the (possibly-updated) approval row, or the original when nothing
   * changed.
   */
  async tally(approvalId: string): Promise<Approval | null> {
    const approval = this.townManager.getApproval(approvalId);
    if (!approval) return null;
    if (approval.status !== 'open') return approval;
    const now = Date.now();
    if (now < approval.expiresAt) return approval;
    const mode = this.modeFor(approval.townId);

    if (mode === 'mayor') {
      // No mayor decision before deadline → expired.
      const ok = this.townManager.updateApproval(approvalId, { status: 'expired' });
      if (!ok) return approval;
      const updated = this.townManager.getApproval(approvalId) ?? approval;
      this.townManager.recordEvent({
        townId: approval.townId,
        kind: 'approval:expired',
        severity: 'minor',
        payload: { approvalId, kind: approval.kind, mode },
        highlightScore: 25,
      });
      this.pendingHandlers.delete(approvalId);
      await this.fireSettledHandler(updated);
      return updated;
    }

    // mode === 'vote' — tally majority. Ties and empty votes go to 'denied'
    // so the proposer must re-issue rather than implicitly succeeding.
    const yes = approval.votes?.yes?.length ?? 0;
    const no = approval.votes?.no?.length ?? 0;
    const result: 'approved' | 'denied' = yes > no ? 'approved' : 'denied';
    const ok = this.townManager.updateApproval(approvalId, { status: result });
    if (!ok) return approval;
    const updated = this.townManager.getApproval(approvalId) ?? approval;
    this.townManager.recordEvent({
      townId: approval.townId,
      kind: result === 'approved' ? 'approval:approved' : 'approval:denied',
      severity: 'major',
      payload: {
        approvalId,
        kind: approval.kind,
        decidedBy: 'vote',
        yes,
        no,
      },
      highlightScore: result === 'approved' ? 70 : 50,
    });
    if (result === 'approved') {
      await this.fireResolveHandler(updated);
    } else {
      this.pendingHandlers.delete(approvalId);
    }
    await this.fireSettledHandler(updated);
    return updated;
  }

  /**
   * Run the heuristic vote for every alive resident on every open approval.
   * Idempotent — castVote overwrites prior choices, but we skip residents
   * who have already cast a vote on this approval. Best-effort: failures
   * are logged and the loop continues.
   *
   * Called by the brain's approvalLoop.
   */
  castHeuristicVotes(townId: string, residents: Array<{ botName: string; personality: string | null; alive: boolean }>): void {
    const open = this.listOpen(townId);
    if (open.length === 0) return;
    const aliveResidents = residents.filter((r) => r.alive);
    if (aliveResidents.length === 0) return;
    for (const approval of open) {
      const votes = approval.votes ?? { yes: [], no: [] };
      const voted = new Set([...(votes.yes ?? []), ...(votes.no ?? [])]);
      for (const r of aliveResidents) {
        if (voted.has(r.botName)) continue;
        try {
          const choice = voteFor(r.personality, approval.kind, approval.payload);
          this.castVote(approval.id, r.botName, choice);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(
            { err: msg, approvalId: approval.id, botName: r.botName },
            'ApprovalManager.castHeuristicVotes: castVote threw',
          );
        }
      }
    }
  }

  /** All open approvals for a town (status === 'open'), newest first. */
  listOpen(townId: string): Approval[] {
    return this.townManager.listApprovals(townId, { status: 'open' });
  }

  /** Every approval for a town regardless of status. */
  listAll(townId: string): Approval[] {
    return this.townManager.listApprovals(townId);
  }

  getApproval(approvalId: string): Approval | null {
    return this.townManager.getApproval(approvalId);
  }

  /**
   * Register a handler that fires once when the named approval resolves to
   * 'approved'. Lives in-process; lost on restart (see file header). When
   * the approval already exists in 'approved' status the handler fires
   * synchronously (covers a creator-side race).
   */
  async resolveOnce(approvalId: string, handler: ApprovalResolveHandler): Promise<void> {
    const approval = this.townManager.getApproval(approvalId);
    if (!approval) {
      logger.warn({ approvalId }, 'ApprovalManager.resolveOnce: unknown approval id');
      return;
    }
    if (approval.status === 'approved') {
      // Already resolved — fire immediately.
      await this.invokeHandler(handler, approval);
      return;
    }
    if (approval.status !== 'open') {
      // Denied or expired — never fire.
      return;
    }
    this.pendingHandlers.set(approvalId, handler);
  }

  /**
   * Register a handler that fires once when the named approval reaches ANY
   * terminal state (approved/denied/expired). Use this for cleanup that must
   * happen regardless of outcome — e.g. ExpansionManager clearing
   * pendingApprovalIds so a denied/expired row doesn't strand the parent.
   *
   * Like resolveOnce, the registry is in-process: a restart drops handlers.
   */
  async onSettled(approvalId: string, handler: ApprovalSettledHandler): Promise<void> {
    const approval = this.townManager.getApproval(approvalId);
    if (!approval) {
      logger.warn({ approvalId }, 'ApprovalManager.onSettled: unknown approval id');
      return;
    }
    if (approval.status !== 'open') {
      // Already terminal — fire synchronously.
      await this.invokeSettled(handler, approval);
      return;
    }
    this.settledHandlers.set(approvalId, handler);
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Resolve the approval mode from the town's config dynamically — read every
   * call so the operator's flip takes effect immediately.
   */
  private modeFor(townId: string): ApprovalMode {
    const town = this.townManager.getTown(townId);
    const cfg = (town?.config ?? {}) as { approvalMode?: ApprovalMode };
    return cfg.approvalMode === 'vote' ? 'vote' : 'mayor';
  }

  private async fireResolveHandler(approval: Approval): Promise<void> {
    const handler = this.pendingHandlers.get(approval.id);
    if (!handler) return;
    this.pendingHandlers.delete(approval.id);
    await this.invokeHandler(handler, approval);
  }

  private async fireSettledHandler(approval: Approval): Promise<void> {
    const handler = this.settledHandlers.get(approval.id);
    if (!handler) return;
    this.settledHandlers.delete(approval.id);
    await this.invokeSettled(handler, approval);
  }

  private async invokeHandler(handler: ApprovalResolveHandler, approval: Approval): Promise<void> {
    try {
      await handler(approval.payload);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, approvalId: approval.id, kind: approval.kind },
        'ApprovalManager: resolveOnce handler threw',
      );
    }
  }

  private async invokeSettled(handler: ApprovalSettledHandler, approval: Approval): Promise<void> {
    try {
      await handler(approval);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, approvalId: approval.id, kind: approval.kind, status: approval.status },
        'ApprovalManager: onSettled handler threw',
      );
    }
  }
}

// Re-export the status helpers so callers can stay on a single import.
export type { Approval, ApprovalKind, ApprovalMode, ApprovalStatus, ApprovalVotes };
