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
 * Phase 8-followup #54 — vote window + heuristic timing
 * ------------------------------------------------------
 * The default vote window now runs five minutes (DEFAULT_VOTE_WINDOW_MS),
 * giving a real human window before the heuristic auto-fills votes. The
 * heuristic itself is deferred until 60% of an approval's window has elapsed
 * (HEURISTIC_DELAY_FRACTION) so a human voter has the early window mostly
 * to themselves; after the threshold the brain trickles in heuristic votes
 * on each tick. Callers may still pass `openFor` to override per-approval.
 *
 * Phase 8-followup #57 — durable handler registry
 * -----------------------------------------------
 * `resolveOnce` and `onSettled` are still in-memory by default, but callers
 * may now attach a HandlerDescriptor — a serialisable `{ kind, payload,
 * target }` blob persisted to the approvals row's `handler_descriptor_json`
 * column. On boot, `rehydrate()` walks every open approval row, looks up
 * the descriptor's kind in a registered-rehydrator map (e.g.
 * ExpansionManager registers 'expansion'), and re-registers the resolveOnce
 * hook so a row that settles to 'approved' after restart still executes
 * the proposer-side action. The rehydrate path is failure-isolated: any
 * descriptor whose kind has no registered handler is logged and skipped —
 * never throws, never crashes startup. Rehydration runs lazily on the
 * first `listOpen` / `castHeuristicVotes` / `tally` call so no extra wiring
 * is needed at boot.
 *
 * Failure isolation: every public method swallows DB errors and returns a
 * sensible falsy/null value so the brain's runLoopSafe wrapper never crashes
 * a tick on a wedged DB.
 */
import path from 'path';
import Database from 'better-sqlite3';
import type { TownManager } from './TownManager';
import type { Approval, ApprovalKind, ApprovalMode, ApprovalStatus, ApprovalVotes } from './Approval';
import { voteFor } from './VoteHeuristic';
import { logger } from '../util/logger';

/**
 * Default vote window (real-time milliseconds) when caller doesn't specify.
 * Phase 8-followup #54: raised from 90s to 5 minutes so humans have a real
 * window before the heuristic auto-fills. Callers may still override per
 * approval via CreateApprovalInput.openFor.
 */
export const DEFAULT_VOTE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Fraction of an approval's window that must elapse before the heuristic
 * starts casting votes (#54). 0.6 means the heuristic stays silent until
 * 60% of the window has passed, then trickles in votes on each tick. Set
 * to 0 to fire on the very first tick (legacy behaviour).
 */
export const HEURISTIC_DELAY_FRACTION = 0.6;

export interface CreateApprovalInput {
  townId: string;
  kind: ApprovalKind | string;
  /** Original proposal payload — replayed verbatim on approval. */
  payload: unknown;
  /** Override the vote window (ms). Defaults to DEFAULT_VOTE_WINDOW_MS. */
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

/**
 * Phase 8-followup #57 — serialisable description of a resolveOnce handler.
 * Stored as JSON in the approvals row's `handler_descriptor_json` column.
 *
 *   kind:    keys the rehydrator registry (e.g. 'expansion').
 *   payload: the original CreateApprovalInput.payload — the rehydrator uses
 *            this to recreate the resolveOnce closure.
 *   target:  optional free-form hint (e.g. parent town id) for the
 *            rehydrator's logs; not used to dispatch.
 */
export interface HandlerDescriptor {
  kind: string;
  payload: unknown;
  target?: string;
}

/**
 * Rehydrator registered by a proposer module (e.g. ExpansionManager) for a
 * given descriptor kind. Receives the persisted descriptor and is expected
 * to call `approvalManager.resolveOnce(approvalId, ...)` itself (and any
 * matching onSettled hook).
 */
export type ApprovalRehydrator = (
  approvalId: string,
  descriptor: HandlerDescriptor,
) => Promise<void> | void;

export class ApprovalManager {
  private readonly townManager: TownManager;
  /**
   * Pending in-flight handlers. Keyed by approvalId. Cleared once invoked
   * (handler fires at most once per approval). Re-populated on boot from
   * the persisted handler descriptor (#57).
   */
  private readonly pendingHandlers: Map<string, ApprovalResolveHandler> = new Map();
  private readonly settledHandlers: Map<string, ApprovalSettledHandler> = new Map();
  /**
   * Tracks approvals whose 'created' / 'expired' / etc. lifecycle event has
   * already fired during this process's lifetime — purely cosmetic, prevents
   * the brain's tally loop from spamming events on repeated ticks.
   */
  private readonly emittedLifecycleEvents: Set<string> = new Set();

  /**
   * #57 — registered rehydrators keyed by HandlerDescriptor.kind. Proposers
   * (ExpansionManager today, others later) register on construction; the
   * lazy rehydrate() call uses these to re-attach resolveOnce handlers for
   * open approvals after restart.
   */
  private readonly rehydrators: Map<string, ApprovalRehydrator> = new Map();
  private rehydrated = false;
  /** Dedicated sqlite handle for handler-descriptor reads/writes. Lazy. */
  private descriptorDb: Database.Database | null = null;
  /** True once we've tried (and failed) to open the descriptor DB. */
  private descriptorDbFailed = false;

  constructor(townManager: TownManager) {
    this.townManager = townManager;
  }

  /**
   * Insert a new approval row. Caller may follow up with `resolveOnce` to
   * register the handler that fires when the approval is approved.
   *
   * #57 — when `handlerDescriptor` is provided, the descriptor is persisted
   * on the approval row immediately so a restart between create and approve
   * can re-register the handler.
   */
  createApproval(
    input: CreateApprovalInput,
    handlerDescriptor?: HandlerDescriptor,
  ): Approval | null {
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
      if (handlerDescriptor) {
        // Persist via direct UPDATE — TownManager.insertApproval doesn't
        // expose the descriptor field yet. Failure is logged + ignored so
        // a wedged descriptor write never breaks the live resolveOnce path.
        this.persistDescriptor(inserted.id, handlerDescriptor);
      }
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
    this.ensureRehydrated();
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
    this.ensureRehydrated();
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
   * #54 — heuristic votes are gated by HEURISTIC_DELAY_FRACTION: an approval
   * whose elapsed-fraction is below the threshold is skipped on this tick.
   * That gives humans a real early window before the heuristic auto-fills.
   *
   * Called by the brain's approvalLoop.
   */
  castHeuristicVotes(townId: string, residents: Array<{ botName: string; personality: string | null; alive: boolean }>): void {
    this.ensureRehydrated();
    const open = this.listOpen(townId);
    if (open.length === 0) return;
    const aliveResidents = residents.filter((r) => r.alive);
    if (aliveResidents.length === 0) return;
    const now = Date.now();
    for (const approval of open) {
      if (!this.heuristicReady(approval, now)) continue;
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
    this.ensureRehydrated();
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
   * 'approved'. Lives in-process. When `descriptor` is provided, it is
   * persisted to the row so a restart can re-register the handler via the
   * registered rehydrator (#57). When the approval already exists in
   * 'approved' status the handler fires synchronously (covers a creator-side
   * race).
   */
  async resolveOnce(
    approvalId: string,
    handler: ApprovalResolveHandler,
    descriptor?: HandlerDescriptor,
  ): Promise<void> {
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
    if (descriptor) {
      this.persistDescriptor(approvalId, descriptor);
    }
  }

  /**
   * Register a handler that fires once when the named approval reaches ANY
   * terminal state (approved/denied/expired). Use this for cleanup that must
   * happen regardless of outcome — e.g. ExpansionManager clearing
   * pendingApprovalIds so a denied/expired row doesn't strand the parent.
   *
   * Like resolveOnce, the registry is in-process: a restart drops handlers.
   * Settled-side cleanup is generally idempotent so rehydrating the
   * resolveOnce side alone is sufficient for #57.
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
  //  #57 — Handler descriptor persistence + rehydration
  // ──────────────────────────────────────────────────────────────────────

  /**
   * Register a rehydrator for the given HandlerDescriptor.kind. Called by
   * proposer modules (ExpansionManager registers 'expansion'). Idempotent —
   * re-registration replaces the previous rehydrator. Triggers an immediate
   * rehydrate pass so descriptors persisted before this registration get
   * picked up.
   */
  registerKindHandler(kind: string, rehydrator: ApprovalRehydrator): void {
    this.rehydrators.set(kind, rehydrator);
    // Best-effort: scan again so any open rows whose descriptor matches this
    // kind get wired up even if rehydrate already ran without us.
    if (this.rehydrated) {
      void this.rehydrateForKind(kind);
    }
  }

  /**
   * Walk every open approval and re-register the resolveOnce hook for each
   * row whose persisted handler descriptor's kind has a known rehydrator.
   * Failure-isolated: a bad descriptor (parse error, unknown kind, throwing
   * rehydrator) is logged and the loop continues. Returns the number of
   * descriptors successfully rehydrated.
   */
  async rehydrate(): Promise<number> {
    this.rehydrated = true;
    const db = this.openDescriptorDb();
    if (!db) return 0;
    let rows: Array<{ id: string; town_id: string | null; handler_descriptor_json: string | null }> = [];
    try {
      rows = db
        .prepare(
          `SELECT id, town_id, handler_descriptor_json FROM approvals WHERE status = 'open' AND handler_descriptor_json IS NOT NULL`,
        )
        .all() as typeof rows;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, 'ApprovalManager.rehydrate: query failed; skipping');
      return 0;
    }
    let restored = 0;
    for (const row of rows) {
      const descriptor = this.parseDescriptor(row.handler_descriptor_json);
      if (!descriptor) continue;
      const ok = await this.dispatchRehydrate(row.id, descriptor);
      if (ok) restored++;
    }
    if (restored > 0) {
      logger.info({ restored }, 'ApprovalManager.rehydrate: re-registered handlers');
    }
    return restored;
  }

  /**
   * Rehydrate just the rows whose descriptor matches a particular kind —
   * called when a rehydrator is registered after rehydrate() has already
   * run, so a late-registered ExpansionManager still picks up its rows.
   */
  private async rehydrateForKind(kind: string): Promise<void> {
    const db = this.openDescriptorDb();
    if (!db) return;
    let rows: Array<{ id: string; handler_descriptor_json: string | null }> = [];
    try {
      rows = db
        .prepare(
          `SELECT id, handler_descriptor_json FROM approvals WHERE status = 'open' AND handler_descriptor_json IS NOT NULL`,
        )
        .all() as typeof rows;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, kind }, 'ApprovalManager.rehydrateForKind: query failed');
      return;
    }
    for (const row of rows) {
      const descriptor = this.parseDescriptor(row.handler_descriptor_json);
      if (!descriptor || descriptor.kind !== kind) continue;
      if (this.pendingHandlers.has(row.id)) continue;
      await this.dispatchRehydrate(row.id, descriptor);
    }
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

  /**
   * #54 — has enough of this approval's window elapsed for the heuristic to
   * trickle in votes? Returns true when:
   *   - elapsed/window >= HEURISTIC_DELAY_FRACTION, OR
   *   - the window is already past expiry (we want a final pre-tally pass).
   */
  private heuristicReady(approval: Approval, now: number): boolean {
    const windowMs = approval.expiresAt - approval.createdAt;
    if (windowMs <= 0) return true;
    if (now >= approval.expiresAt) return true;
    const elapsed = now - approval.createdAt;
    return elapsed / windowMs >= HEURISTIC_DELAY_FRACTION;
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

  /** Lazy rehydrate — called from any public path that benefits from it. */
  private ensureRehydrated(): void {
    if (this.rehydrated) return;
    // Fire-and-forget; rehydrate sets the flag synchronously up-front.
    void this.rehydrate();
  }

  private async dispatchRehydrate(
    approvalId: string,
    descriptor: HandlerDescriptor,
  ): Promise<boolean> {
    const rehydrator = this.rehydrators.get(descriptor.kind);
    if (!rehydrator) {
      // Defensive log-and-skip: an open row may carry a kind whose proposer
      // module isn't registered this process — e.g. a 'decree' row persisted
      // while governance was on, then the flag turned off so DecreeManager
      // (which registers the 'decree' rehydrator) is never constructed. We
      // intentionally leave the row open and untouched rather than throwing;
      // re-enabling the flag re-registers the rehydrator and picks it up.
      logger.debug(
        { approvalId, kind: descriptor.kind },
        'ApprovalManager.rehydrate: no rehydrator registered for kind; skipping',
      );
      return false;
    }
    try {
      await rehydrator(approvalId, descriptor);
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, approvalId, kind: descriptor.kind },
        'ApprovalManager.rehydrate: rehydrator threw',
      );
      return false;
    }
  }

  private parseDescriptor(json: string | null | undefined): HandlerDescriptor | null {
    if (!json) return null;
    try {
      const parsed = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object') return null;
      const obj = parsed as { kind?: unknown; payload?: unknown; target?: unknown };
      if (typeof obj.kind !== 'string') return null;
      return {
        kind: obj.kind,
        payload: obj.payload,
        target: typeof obj.target === 'string' ? obj.target : undefined,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg }, 'ApprovalManager.parseDescriptor: invalid JSON');
      return null;
    }
  }

  private persistDescriptor(approvalId: string, descriptor: HandlerDescriptor): void {
    const db = this.openDescriptorDb();
    if (!db) return;
    try {
      db.prepare(`UPDATE approvals SET handler_descriptor_json = ? WHERE id = ?`).run(
        JSON.stringify(descriptor),
        approvalId,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg, approvalId, kind: descriptor.kind },
        'ApprovalManager.persistDescriptor: UPDATE failed',
      );
    }
  }

  /**
   * Open a dedicated better-sqlite3 handle to the same town.db file the
   * TownManager owns, just for handler_descriptor_json reads/writes. Multiple
   * connections to the same file are safe under SQLite's WAL mode (which
   * TownManager already enables). Failure is sticky (descriptorDbFailed) so
   * we don't thrash retry on a broken DB.
   */
  private openDescriptorDb(): Database.Database | null {
    if (this.descriptorDb) return this.descriptorDb;
    if (this.descriptorDbFailed) return null;
    try {
      const dataDir = this.townManager.getDataDir();
      const dbPath = path.join(dataDir, 'town.db');
      const handle = new Database(dbPath);
      handle.pragma('journal_mode = WAL');
      this.descriptorDb = handle;
      return handle;
    } catch (err: unknown) {
      this.descriptorDbFailed = true;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { err: msg },
        'ApprovalManager.openDescriptorDb: failed to open companion handle; handler persistence disabled for this process',
      );
      return null;
    }
  }
}

// Re-export the status helpers so callers can stay on a single import.
export type { Approval, ApprovalKind, ApprovalMode, ApprovalStatus, ApprovalVotes };
