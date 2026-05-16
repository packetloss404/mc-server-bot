/**
 * Approval domain model — Phase 6-B.
 *
 * Mirrors the `approvals` table in src/town/schema.ts. JSON fields are parsed
 * into structured objects; status / mode strings are typed as discriminated
 * unions so the brain + dashboard stay in sync.
 */

/** Stable kinds for the Phase 6 launch — extra strings are allowed. */
export type ApprovalKind =
  | 'expansion'
  | 'construction'
  | 'milestone'
  | 'decree'
  | string;

export type ApprovalStatus = 'open' | 'approved' | 'denied' | 'expired';

export type ApprovalMode = 'mayor' | 'vote';

/** Bot-name lists by choice. Empty arrays are valid. */
export interface ApprovalVotes {
  yes: string[];
  no: string[];
}

export interface Approval {
  id: string;
  townId: string;
  kind: ApprovalKind;
  /** Original proposal blob — replayed verbatim when approved. */
  payload: unknown;
  status: ApprovalStatus;
  createdAt: number;
  expiresAt: number;
  /** 'approved' | 'denied' | null — only set on mayor-direct decisions. */
  mayorDecision: 'approved' | 'denied' | null;
  votes: ApprovalVotes;
}
