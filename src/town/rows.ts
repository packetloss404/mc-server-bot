/**
 * Shared row helpers for the town persistence layer — id generation, defensive
 * JSON parsing, and DB-row → domain-object mappers. Lifted out of TownManager
 * (review: god-object decomposition) so the per-domain repositories can share
 * them without depending on TownManager. Mappers are added here as each domain
 * repository is extracted.
 */
import crypto from 'crypto';
import * as schema from './schema';
import type { Approval, ApprovalStatus, ApprovalVotes } from './Approval';
import type { Relationship, RelationshipEvent, RelationshipState } from './Relationship';
import { clampTrust, DEFAULT_TRUST } from './diplomacy';

type ApprovalRow = typeof schema.approvals.$inferSelect;
type RelationshipRow = typeof schema.relationships.$inferSelect;

/** Prefixed, time-ordered, collision-resistant id (e.g. `apv_lz4k_3f9a1c20`). */
export function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

/** Parse JSON, returning `fallback` on null/parse error (never throws). */
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function rowToApproval(row: ApprovalRow): Approval {
  const votes = safeJsonParse<ApprovalVotes>(row.votesJson ?? null, { yes: [], no: [] });
  // Defensive: an empty/legacy row may serialise as {} — normalise to arrays.
  const safeVotes: ApprovalVotes = {
    yes: Array.isArray(votes?.yes) ? votes.yes : [],
    no: Array.isArray(votes?.no) ? votes.no : [],
  };
  return {
    id: row.id,
    townId: row.townId ?? '',
    kind: row.kind,
    payload: safeJsonParse<unknown>(row.payloadJson ?? null, null),
    status: (row.status as ApprovalStatus) ?? 'open',
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    mayorDecision:
      row.mayorDecision === 'approved' || row.mayorDecision === 'denied'
        ? row.mayorDecision
        : null,
    votes: safeVotes,
  };
}

export function rowToRelationship(row: RelationshipRow): Relationship {
  const events = safeJsonParse<RelationshipEvent[]>(row.eventsJson ?? null, []);
  return {
    townIdA: row.townIdA ?? '',
    townIdB: row.townIdB ?? '',
    state: ((row.state as RelationshipState) ?? 'neutral'),
    trust: typeof row.trust === 'number' ? clampTrust(row.trust) : DEFAULT_TRUST,
    lastInteractionAt: row.lastInteractionAt ?? 0,
    events: Array.isArray(events) ? events : [],
  };
}
