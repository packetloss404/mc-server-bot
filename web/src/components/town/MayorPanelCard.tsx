'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type MayorDecreeTaskDTO } from '@/lib/api';
import { useToast } from '@/components/Toast';
import type { Town } from '@/lib/townStore';

interface Props {
  town: Town;
}

const POLL_MS = 30_000;
const MAX_DECREE_LENGTH = 1000;

/**
 * Phase 6-A Mayor panel.
 *
 * Surfaces the current mayor honorific + name, plus a free-form textarea
 * the mayor can use to drop a "decree" onto the blackboard as a
 * high-priority swarm task.
 *
 * Polls /api/towns/:id every 30s — the panel itself doesn't have a
 * dedicated endpoint; it reads the mayor fields from the town DTO so it
 * stays current when Phase 6-B re-elects a mayor.
 *
 * Decree history is locally cached (last 3) because the backend doesn't
 * persist a `mayor_directive` feed yet. When the page refreshes the list
 * resets — that's the "no decrees yet" empty state mentioned in the brief.
 */
export function MayorPanelCard({ town }: Props) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  /**
   * In-memory history of decrees issued from THIS tab in the current
   * session. Persisting across reloads is a Phase-7 followup; we keep the
   * last 3 so the mayor sees an instant confirmation that the directive
   * was queued.
   */
  const [recent, setRecent] = useState<MayorDecreeTaskDTO[]>([]);

  // Background re-poll of the town record so a Phase-6-B re-election shows
  // up here without the user navigating away. We don't push results into
  // the store — the parent /town page already polls the town list. We just
  // mirror the latest title/name into local state.
  const [mayorTitle, setMayorTitle] = useState<string | null>(town.mayorTitle ?? null);
  const [mayorPlayerName, setMayorPlayerName] = useState<string | null>(
    town.mayorPlayerName ?? null,
  );

  useEffect(() => {
    setMayorTitle(town.mayorTitle ?? null);
    setMayorPlayerName(town.mayorPlayerName ?? null);
  }, [town.mayorTitle, town.mayorPlayerName]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const { town: latest } = await api.getTown(town.id);
        if (cancelled) return;
        setMayorTitle(latest.mayorTitle ?? null);
        setMayorPlayerName(latest.mayorPlayerName ?? null);
      } catch {
        // Backend hiccup — silent; next tick retries.
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [town.id]);

  const honorific = useMemo(() => {
    return [mayorTitle, mayorPlayerName].filter(Boolean).join(' ').trim();
  }, [mayorTitle, mayorPlayerName]);

  const canSubmit = !!mayorPlayerName && text.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!mayorPlayerName) {
      toast('No mayor is set for this town.', 'error');
      return;
    }
    const body = text.trim();
    if (!body) return;
    setSubmitting(true);
    try {
      const { task } = await api.issueMayorDecree(town.id, mayorPlayerName, body);
      setRecent((prev) => [task, ...prev].slice(0, 3));
      setText('');
      toast('Decree issued.', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to issue decree.';
      toast(msg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-white">Mayor</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            Issue a town-wide decree — drops a high-priority task onto the swarm.
          </p>
        </div>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">30s poll</span>
      </header>

      <div className="p-4 space-y-4">
        {/* Mayor identity */}
        <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
          <div className="shrink-0 w-9 h-9 rounded-full bg-amber-500/15 text-amber-300 flex items-center justify-center text-base font-bold">
            {(mayorPlayerName ?? '?').slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider font-semibold text-amber-400/80">
              Current Mayor
            </div>
            <div className="text-sm font-semibold text-amber-200 truncate" title={honorific}>
              {honorific || 'No mayor set'}
            </div>
          </div>
        </div>

        {/* Decree form */}
        <div className="space-y-2">
          <label className="block">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
              Issue a decree
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_DECREE_LENGTH))}
              placeholder="Build a watchtower at the east wall. Stockpile 64 stone in the central chest."
              rows={3}
              disabled={!mayorPlayerName || submitting}
              className="mt-1.5 w-full bg-zinc-900 border border-zinc-800 text-zinc-100 text-sm rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500/60 disabled:opacity-50 resize-y"
            />
          </label>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-zinc-600 tabular-nums">
              {text.length}/{MAX_DECREE_LENGTH}
            </span>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 transition-colors px-4 py-1.5 rounded-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Issuing…' : 'Issue Decree'}
            </button>
          </div>
        </div>

        {/* Recent decrees (session-local) */}
        <div className="space-y-1.5">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
            Recent decrees
          </span>
          {recent.length === 0 ? (
            <p className="text-[11px] text-zinc-600 italic">No decrees yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {recent.map((task) => (
                <li
                  key={task.id}
                  className="text-[11px] text-zinc-300 bg-zinc-950/60 border border-zinc-800/60 rounded-md px-2.5 py-1.5"
                >
                  <div className="truncate" title={task.description}>
                    {task.description}
                  </div>
                  <div className="text-[9px] text-zinc-500 mt-0.5 uppercase tracking-wider">
                    {task.priority ?? 'high'} priority
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

export default MayorPanelCard;
