'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type TownApprovalDTO } from '@/lib/api';
import { useToast } from '@/components/Toast';
import type { Town } from '@/lib/townStore';

interface Props {
  town: Town;
}

const POLL_MS = 10_000;

/**
 * Phase 6-B Approval Queue card.
 *
 * Lists every open approval row produced by the town brain (today: 2nd+
 * child-town expansions). Two surfaces depending on the town's approval mode:
 *
 *   - 'mayor' (default): show Approve / Deny buttons. The dashboard caller
 *     is treated as the mayor — the backend echoes mayorPlayerName but does
 *     NOT enforce identity for Phase 6 (mayor identity check is wired with
 *     the Phase 6-A mayor decree route's `requireMayor` middleware; that
 *     check is intentionally NOT applied here so a town admin can override
 *     a stuck queue regardless of who's logged in).
 *   - 'vote': render a vote-tally bar + countdown. Voting is heuristic +
 *     happens server-side on every brain tick, so the card is read-only
 *     here.
 *
 * Polls every 10s. Settled approvals (approved/denied/expired) drop off the
 * list automatically because the backend filters by status=open.
 */
export function ApprovalQueueCard({ town }: Props) {
  const { toast } = useToast();
  const [approvals, setApprovals] = useState<TownApprovalDTO[]>([]);
  const [mode, setMode] = useState<'mayor' | 'vote'>('mayor');
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * Tick counter so the per-row countdowns re-render every second without
   * re-fetching from the server. We refresh the actual data every 10s
   * instead.
   */
  const [, setNow] = useState(Date.now());

  // 1Hz local clock so countdowns animate. Cheap — just a state bump.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  // Poll the queue.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const { approvals: list, mode: serverMode } = await api.listTownApprovals(town.id, {
        status: 'open',
      });
      if (cancelled) return;
      setApprovals(list);
      setMode(serverMode);
      setLoaded(true);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [town.id]);

  const refresh = async () => {
    const { approvals: list, mode: serverMode } = await api.listTownApprovals(town.id, {
      status: 'open',
    });
    setApprovals(list);
    setMode(serverMode);
  };

  const handleDecide = async (approvalId: string, choice: 'approved' | 'denied') => {
    if (busyId) return;
    setBusyId(approvalId);
    try {
      await api.decideApproval(town.id, approvalId, choice, town.mayorPlayerName ?? undefined);
      toast(
        `Approval ${choice === 'approved' ? 'approved' : 'denied'}`,
        choice === 'approved' ? 'success' : 'info',
      );
      // Optimistic refresh so the row drops off without waiting for the poll.
      refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Decision failed';
      toast(msg, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">Approval Queue</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            {mode === 'vote'
              ? 'Resident vote — bots cast yes/no by personality. Majority wins after the window.'
              : 'Mayor-direct — approve or deny each pending action.'}
          </p>
        </div>
        <span
          className={`shrink-0 text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded border ${
            mode === 'vote'
              ? 'border-cyan-500/30 text-cyan-300 bg-cyan-500/10'
              : 'border-amber-500/30 text-amber-300 bg-amber-500/10'
          }`}
        >
          {mode}
        </span>
      </header>

      <div className="p-4">
        {!loaded ? (
          <div className="text-center py-6 text-xs text-zinc-500">Loading approvals…</div>
        ) : approvals.length === 0 ? (
          <div className="text-center py-6 text-xs text-zinc-500">
            No pending approvals. New gated actions (e.g. a 2nd child-town expansion) will appear
            here.
          </div>
        ) : (
          <ul className="space-y-2">
            {approvals.map((a) => (
              <ApprovalRow
                key={a.id}
                approval={a}
                mode={mode}
                busy={busyId === a.id}
                onDecide={handleDecide}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface RowProps {
  approval: TownApprovalDTO;
  mode: 'mayor' | 'vote';
  busy: boolean;
  onDecide: (approvalId: string, choice: 'approved' | 'denied') => void;
}

function ApprovalRow({ approval, mode, busy, onDecide }: RowProps) {
  const yes = approval.votes?.yes?.length ?? 0;
  const no = approval.votes?.no?.length ?? 0;
  const total = yes + no;
  const yesPct = total === 0 ? 0 : Math.round((yes / total) * 100);
  const summary = useMemo(() => summarizePayload(approval.kind, approval.payload), [
    approval.kind,
    approval.payload,
  ]);

  return (
    <li className="px-3 py-2.5 rounded-lg border border-zinc-800/60 bg-zinc-950/40">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border ${kindChip(
                approval.kind,
              )}`}
            >
              {approval.kind}
            </span>
            <span className="text-xs font-semibold text-zinc-100 truncate">{summary}</span>
          </div>
          <div className="text-[10px] text-zinc-500 mt-1 flex items-center gap-2">
            <CountdownLabel mode={mode} expiresAt={approval.expiresAt} />
          </div>
        </div>

        {mode === 'mayor' ? (
          <div className="shrink-0 flex items-center gap-1">
            <button
              type="button"
              onClick={() => onDecide(approval.id, 'approved')}
              disabled={busy}
              className="text-[11px] font-semibold text-white bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-wait transition-colors px-3 py-1.5 rounded-md"
            >
              {busy ? '…' : 'Approve'}
            </button>
            <button
              type="button"
              onClick={() => onDecide(approval.id, 'denied')}
              disabled={busy}
              className="text-[11px] font-semibold text-white bg-rose-600/90 hover:bg-rose-500 disabled:opacity-60 disabled:cursor-wait transition-colors px-3 py-1.5 rounded-md"
            >
              {busy ? '…' : 'Deny'}
            </button>
          </div>
        ) : (
          <div className="shrink-0 text-right">
            <div className="text-[10px] text-zinc-500 font-mono">
              {yes} yes · {no} no
            </div>
          </div>
        )}
      </div>

      {/* Vote tally bar (always shown — useful even in mayor mode if a few
          residents weighed in for advisory purposes). */}
      <div className="mt-2">
        <div className="h-1.5 w-full rounded-full bg-zinc-800 overflow-hidden flex">
          <div
            className="h-full bg-emerald-500/80"
            style={{ width: `${yesPct}%` }}
            aria-label={`${yesPct}% yes votes`}
          />
          <div
            className="h-full bg-rose-500/70"
            style={{ width: `${100 - yesPct}%` }}
            aria-label={`${100 - yesPct}% no votes`}
          />
        </div>
      </div>
    </li>
  );
}

function CountdownLabel({ mode, expiresAt }: { mode: 'mayor' | 'vote'; expiresAt: number }) {
  const remainingMs = expiresAt - Date.now();
  const seconds = Math.max(0, Math.floor(remainingMs / 1000));
  if (seconds <= 0) {
    return <span className="text-amber-400/80">Window closed — awaiting tally</span>;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const label = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  if (mode === 'vote') {
    return <span>Voting open · closes in {label}</span>;
  }
  return <span>Pending mayor decision · expires in {label}</span>;
}

function kindChip(kind: string): string {
  switch (kind) {
    case 'expansion':
      return 'border-cyan-500/30 text-cyan-300 bg-cyan-500/10';
    case 'construction':
      return 'border-amber-500/30 text-amber-300 bg-amber-500/10';
    case 'milestone':
      return 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10';
    case 'decree':
      return 'border-fuchsia-500/30 text-fuchsia-300 bg-fuchsia-500/10';
    default:
      return 'border-zinc-700/60 text-zinc-400 bg-zinc-800/40';
  }
}

/**
 * Render a one-line summary of the proposal payload. Each kind has a
 * tailored extractor; unknown kinds fall back to a JSON-keys dump so a
 * future approval kind still shows something readable.
 */
function summarizePayload(kind: string, payload: unknown): string {
  if (!payload || typeof payload !== 'object') return `${kind} (no payload)`;
  const p = payload as Record<string, unknown>;
  switch (kind) {
    case 'expansion': {
      const childName = (p.childName as string) ?? '?';
      const direction = (p.direction as string) ?? '?';
      const cap = p.childCapital as { x?: number; z?: number } | undefined;
      const coords = cap ? `(${Math.round(cap.x ?? 0)}, ${Math.round(cap.z ?? 0)})` : '';
      return `Found "${childName}" — ${direction} ${coords}`.trim();
    }
    default: {
      // Best-effort: surface the first 2–3 keys.
      const keys = Object.keys(p).slice(0, 3).join(', ');
      return keys ? `${kind} (${keys})` : kind;
    }
  }
}

export default ApprovalQueueCard;
