/**
 * ApprovalRepository — persistence for the approvals table, extracted from
 * TownManager (review: god-object decomposition). Pure CRUD over the shared
 * drizzle connection; on a write failure it routes the row to the JSONL
 * fallback via an injected callback (TownManager still owns the centralized
 * replay). TownManager keeps thin delegating methods so external callers
 * (ApprovalManager, api.ts) are unaffected.
 */
import { and, desc, eq } from 'drizzle-orm';
import * as schema from './schema';
import type { TownDb } from './db';
import type { Approval, ApprovalKind, ApprovalStatus, ApprovalVotes } from './Approval';
import { genId, rowToApproval } from './rows';
import { logger } from '../util/logger';

type ApprovalRow = typeof schema.approvals.$inferSelect;

export type FallbackAppend = (table: string, townId: string, row: unknown) => void;

export class ApprovalRepository {
  constructor(
    private readonly db: TownDb,
    private readonly fallbackAppend: FallbackAppend,
  ) {}

  insertApproval(input: {
    townId: string;
    kind: ApprovalKind | string;
    payload: unknown;
    createdAt: number;
    expiresAt: number;
    status?: ApprovalStatus;
  }): Approval | null {
    const id = genId('apv');
    const status: ApprovalStatus = input.status ?? 'open';
    const votes: ApprovalVotes = { yes: [], no: [] };
    const approval: Approval = {
      id,
      townId: input.townId,
      kind: input.kind,
      payload: input.payload,
      status,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      mayorDecision: null,
      votes,
    };
    try {
      this.db
        .insert(schema.approvals)
        .values({
          id,
          townId: input.townId,
          kind: input.kind,
          payloadJson: input.payload == null ? null : JSON.stringify(input.payload),
          status,
          createdAt: input.createdAt,
          expiresAt: input.expiresAt,
          mayorDecision: null,
          votesJson: JSON.stringify(votes),
        })
        .run();
    } catch (err: any) {
      this.fallbackAppend('approvals', input.townId, {
        id,
        townId: input.townId,
        kind: input.kind,
        payload: input.payload,
        status,
        createdAt: input.createdAt,
        expiresAt: input.expiresAt,
        mayorDecision: null,
        votes,
      });
      logger.warn(
        { err: err?.message, townId: input.townId, kind: input.kind },
        'insertApproval: DB write failed; routed to fallback',
      );
    }
    return approval;
  }

  /**
   * Patch an approval row. Only fields explicitly present in `patch` are
   * touched. Returns true on a successful update, false when the row is
   * missing or the DB write throws.
   */
  updateApproval(
    approvalId: string,
    patch: {
      status?: ApprovalStatus;
      mayorDecision?: 'approved' | 'denied' | null;
      votes?: ApprovalVotes;
      expiresAt?: number;
    },
  ): boolean {
    try {
      const current = this.db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.id, approvalId))
        .get();
      if (!current) return false;
      const fields: Partial<ApprovalRow> = {};
      if (patch.status !== undefined) fields.status = patch.status;
      if (patch.mayorDecision !== undefined) fields.mayorDecision = patch.mayorDecision;
      if (patch.expiresAt !== undefined) fields.expiresAt = patch.expiresAt;
      if (patch.votes !== undefined) {
        fields.votesJson = JSON.stringify({
          yes: Array.isArray(patch.votes.yes) ? patch.votes.yes : [],
          no: Array.isArray(patch.votes.no) ? patch.votes.no : [],
        });
      }
      if (Object.keys(fields).length === 0) return true;
      this.db
        .update(schema.approvals)
        .set(fields)
        .where(eq(schema.approvals.id, approvalId))
        .run();
      return true;
    } catch (err: any) {
      logger.warn({ err: err?.message, approvalId }, 'updateApproval: DB write failed');
      return false;
    }
  }

  /**
   * List approvals for a town. Filtered by status when provided; newest first
   * by createdAt. Capped at 200 rows so a runaway queue can't blow up the
   * response.
   */
  listApprovals(
    townId: string,
    opts: { status?: ApprovalStatus | 'all'; limit?: number } = {},
  ): Approval[] {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
    try {
      const whereExpr =
        opts.status && opts.status !== 'all'
          ? and(eq(schema.approvals.townId, townId), eq(schema.approvals.status, opts.status))
          : eq(schema.approvals.townId, townId);
      const rows = this.db
        .select()
        .from(schema.approvals)
        .where(whereExpr)
        .orderBy(desc(schema.approvals.createdAt))
        .limit(limit)
        .all();
      return rows.map(rowToApproval);
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId, status: opts.status },
        'listApprovals: read failed; returning empty list',
      );
      return [];
    }
  }

  getApproval(approvalId: string): Approval | null {
    try {
      const row = this.db
        .select()
        .from(schema.approvals)
        .where(eq(schema.approvals.id, approvalId))
        .get();
      return row ? rowToApproval(row) : null;
    } catch (err: any) {
      logger.warn({ err: err?.message, approvalId }, 'getApproval: read failed');
      return null;
    }
  }
}
