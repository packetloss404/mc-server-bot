'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDecisionStore, type DecisionRecord } from './store';
import { api } from './api';

const ROLLING_CAP = 50;

/**
 * normalizeDecision — coerce an arbitrary payload (either the TraceRecord
 * shape from the worker, or the friendly `action/reason/target/alternatives`
 * shape used by some emitters) into a stable DecisionRecord.
 */
function normalizeDecision(raw: Record<string, unknown>, fallbackBot: string): DecisionRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const botName = (typeof raw.botName === 'string' && raw.botName) || fallbackBot;
  if (!botName) return null;
  const decision = typeof raw.decision === 'string' ? raw.decision : undefined;
  const summary = typeof raw.summary === 'string' ? raw.summary : undefined;
  const action = typeof raw.action === 'string' ? raw.action : decision;
  const reason = typeof raw.reason === 'string' ? raw.reason : summary;
  return {
    id: String(raw.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    type: String(raw.type ?? 'action'),
    botName,
    task: typeof raw.task === 'string' ? raw.task : undefined,
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
    summary,
    decision,
    action,
    reason,
    target: typeof raw.target === 'string' ? raw.target : undefined,
    metadata:
      raw.metadata && typeof raw.metadata === 'object'
        ? (raw.metadata as Record<string, unknown>)
        : undefined,
    alternatives: Array.isArray(raw.alternatives)
      ? (raw.alternatives as DecisionRecord['alternatives'])
      : undefined,
    candidates: Array.isArray(raw.candidates)
      ? (raw.candidates as DecisionRecord['candidates'])
      : undefined,
    details:
      raw.details && typeof raw.details === 'object'
        ? (raw.details as Record<string, unknown>)
        : undefined,
  };
}

/**
 * useBotDecisions — returns a deduplicated, newest-first decision timeline
 * for a single bot. On mount it HTTP-fetches the last `limit` decisions
 * from `/api/bots/:name/decisions` and seeds the Zustand decision store.
 * Live updates arrive via the `bot:decision` Socket.IO listener (wired in
 * SocketProvider).
 *
 * Output is capped at 50 entries.
 */
export function useBotDecisions(
  botName: string,
  options: { limit?: number } = {},
): { decisions: DecisionRecord[]; loading: boolean } {
  const limit = options.limit ?? 30;
  const [loading, setLoading] = useState(true);
  const key = botName ? botName.toLowerCase() : '';

  // Subscribe to the per-bot slice of the decision store. Returning the
  // same array reference when nothing changes is important for React perf.
  const buffer = useDecisionStore((state) => (key ? state.decisionsByBot[key] : undefined));

  useEffect(() => {
    let cancelled = false;
    if (!botName) {
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getBotDecisions(botName, limit)
      .then((data) => {
        if (cancelled) return;
        const decisions = Array.isArray(data?.decisions) ? data.decisions : [];
        const normalized = decisions
          .map((d) => normalizeDecision(d as Record<string, unknown>, botName))
          .filter((d): d is DecisionRecord => d !== null);
        useDecisionStore.getState().setDecisions(botName, normalized);
      })
      .catch(() => {
        // 404 (bot not found yet) or network errors are non-fatal — the
        // socket subscription will populate the buffer as decisions occur.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [botName, limit]);

  const decisions = useMemo(() => {
    if (!buffer) return [];
    // Buffer is already deduped/sorted by the store; just cap to be safe.
    return buffer.slice(0, ROLLING_CAP);
  }, [buffer]);

  return { decisions, loading };
}
