/**
 * DecreeManager — Project Sid P2-C ("Governance that bites").
 *
 * Closes Sid's follow→amend→re-follow loop: lets a BOT (or a town-level
 * trigger) PROPOSE a standing rule through the existing approval/vote
 * workflow, rather than only the mayor minting rules directly (P2-A).
 *
 * Flow (mirrors ExpansionManager's Phase 6-B approval producer):
 *   1. `proposeDecree({ townId, text, proposedBy })` opens a `decree`
 *      approval row via ApprovalManager.createApproval and registers a
 *      resolveOnce hook.
 *   2. The town's residents vote (VoteHeuristic already has 'decree' entries)
 *      or the mayor decides; ApprovalManager resolves the row.
 *   3. On 'approved', the resolveOnce hook calls `RuleStore.addRule(townId,
 *      text)` — the proposal becomes a live standing rule that biases task
 *      selection (P2-A scoring) and resident prompts (P2-B injection).
 *   4. Denied/expired rows fire nothing (the proposer must re-issue).
 *
 * Durable rehydration (#57 pattern): a `decree` HandlerDescriptor is persisted
 * on the approval row, and `setApprovalManager` registers a 'decree'
 * rehydrator so a restart between propose and approve still creates the rule
 * when the row settles to 'approved'.
 *
 * Gating: every caller path is gated behind `config.governance.enabled`. When
 * the flag is off, no decree approvals are produced and this manager is a
 * complete no-op (the brain doesn't even construct one).
 *
 * Failure isolation: the propose/resolve paths swallow errors + log, matching
 * ExpansionManager — a wedged DB never crashes a brain tick.
 */
import type { TownManager } from './TownManager';
import type { ApprovalManager, HandlerDescriptor } from './ApprovalManager';
import type { RuleStore, TownRule } from './RuleStore';
import { logger } from '../util/logger';

/** Descriptor kind persisted into approvals.handler_descriptor_json (#57). */
export const DECREE_HANDLER_KIND = 'decree';

/** Hard cap on proposed decree text — mirrors the mayor/decree route. */
export const MAX_DECREE_TEXT_LENGTH = 1000;

/**
 * Serialisable payload replayed verbatim on approval. `proposedBy` is purely
 * for events/logs (a bot name, 'town', or a player); it doesn't gate the rule.
 */
export interface DecreeProposalPayload {
  townId: string;
  text: string;
  proposedBy?: string;
}

export class DecreeManager {
  private readonly townManager: TownManager;
  private readonly ruleStore: RuleStore;
  private approvalManager: ApprovalManager | null;

  constructor(
    townManager: TownManager,
    ruleStore: RuleStore,
    approvalManager: ApprovalManager | null = null,
  ) {
    this.townManager = townManager;
    this.ruleStore = ruleStore;
    this.approvalManager = approvalManager;
    if (this.approvalManager) this.registerRehydrator(this.approvalManager);
  }

  /**
   * Wire (or replace) the approval manager and register the 'decree'
   * rehydrator so the boot-time rehydrate() re-attaches the resolveOnce hook
   * for any open decree row persisted before this process started.
   * Idempotent on ApprovalManager's side.
   */
  setApprovalManager(approvalManager: ApprovalManager | null): void {
    this.approvalManager = approvalManager;
    if (approvalManager) this.registerRehydrator(approvalManager);
  }

  private registerRehydrator(approvalManager: ApprovalManager): void {
    approvalManager.registerKindHandler(DECREE_HANDLER_KIND, (approvalId, descriptor) =>
      this.rehydrateHandler(approvalId, descriptor),
    );
  }

  /**
   * Open a `decree` approval for a proposed standing rule and register the
   * resolveOnce hook that turns an approval into a live rule. Returns the
   * approval id, or null when the approval couldn't be created (no approval
   * manager wired, empty/oversize text, or a DB failure). Best-effort — never
   * throws into the brain tick.
   */
  async proposeDecree(payload: DecreeProposalPayload): Promise<string | null> {
    if (!this.approvalManager) {
      logger.debug({ townId: payload.townId }, 'DecreeManager.proposeDecree: no approval manager wired; skipping');
      return null;
    }
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) {
      logger.warn({ townId: payload.townId }, 'DecreeManager.proposeDecree: empty text; skipping');
      return null;
    }
    if (text.length > MAX_DECREE_TEXT_LENGTH) {
      logger.warn({ townId: payload.townId, len: text.length }, 'DecreeManager.proposeDecree: text exceeds cap; skipping');
      return null;
    }
    const normalized: DecreeProposalPayload = {
      townId: payload.townId,
      text,
      proposedBy: payload.proposedBy,
    };
    const descriptor: HandlerDescriptor = {
      kind: DECREE_HANDLER_KIND,
      payload: normalized,
      target: payload.townId,
    };
    try {
      const approval = this.approvalManager.createApproval(
        { townId: payload.townId, kind: DECREE_HANDLER_KIND, payload: normalized },
        descriptor,
      );
      if (!approval) return null;
      await this.approvalManager.resolveOnce(
        approval.id,
        async () => { this.applyApproved(normalized); },
        descriptor,
      );
      logger.info(
        { approvalId: approval.id, townId: payload.townId, proposedBy: payload.proposedBy },
        'DecreeManager: decree proposed (awaiting approval)',
      );
      return approval.id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, townId: payload.townId }, 'DecreeManager.proposeDecree: failed');
      return null;
    }
  }

  /**
   * #57 — replay the resolveOnce hook for a persisted decree row. Called by
   * ApprovalManager.rehydrate(). Validates the descriptor payload, then
   * re-registers the same applyApproved hook the live path would have.
   * Failure-isolated.
   */
  async rehydrateHandler(approvalId: string, descriptor: HandlerDescriptor): Promise<void> {
    if (!this.approvalManager) return;
    const payload = descriptor.payload as DecreeProposalPayload | null | undefined;
    if (!payload || typeof payload !== 'object' || typeof payload.townId !== 'string' || typeof payload.text !== 'string') {
      logger.warn(
        { approvalId, kind: descriptor.kind, target: descriptor.target },
        'DecreeManager.rehydrateHandler: descriptor payload is not a DecreeProposalPayload; skipping',
      );
      return;
    }
    await this.approvalManager.resolveOnce(approvalId, async () => {
      this.applyApproved(payload);
    });
    logger.info({ approvalId, townId: payload.townId }, 'DecreeManager.rehydrateHandler: re-registered decree approval');
  }

  /**
   * Turn an approved decree proposal into a live standing rule. Records a
   * `mayor:decree` event so the decree feed + dashboard surface it exactly
   * like a mayor-minted rule. Best-effort.
   */
  private applyApproved(payload: DecreeProposalPayload): void {
    let rule: TownRule | undefined;
    try {
      rule = this.ruleStore.addRule(payload.townId, payload.text);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err: msg, townId: payload.townId }, 'DecreeManager.applyApproved: addRule failed');
      return;
    }
    try {
      this.townManager.recordEvent({
        townId: payload.townId,
        kind: 'mayor:decree',
        severity: 'major',
        payload: {
          text: payload.text,
          source: 'proposed_decree',
          proposedBy: payload.proposedBy,
          ruleId: rule.id,
        },
        highlightScore: 60,
      });
    } catch {
      /* event recording is cosmetic — the rule is already persisted */
    }
    logger.info(
      { townId: payload.townId, ruleId: rule.id, proposedBy: payload.proposedBy },
      'DecreeManager: proposed decree approved → standing rule created',
    );
  }
}
