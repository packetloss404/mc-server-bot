'use client';

import { useEffect, useState } from 'react';
import { api, type TownBrainStatusDTO } from '@/lib/api';

/**
 * Followup #38 — TownBrain lifecycle widget.
 *
 * Renders running/paused state, total tick count, and a "last tick Xs ago"
 * relative timestamp for the active town. Polls every 10s; the brain itself
 * ticks at 60s so a 10s poll keeps the "Xs ago" reading reasonably honest
 * without hammering the API.
 *
 * The card swallows GET errors (api.getBrainStatus catches) so it just hides
 * the body until the backend boots.
 */
interface Props {
  townId: string;
}

const POLL_MS = 10_000;

export function BrainStatusCard({ townId }: Props) {
  const [status, setStatus] = useState<TownBrainStatusDTO | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Re-render every second so the "last tick Xs ago" label stays fresh
  // without re-fetching from the API on every tick.
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setStatus(null);
    const tick = async () => {
      const res = await api.getBrainStatus(townId);
      if (cancelled) return;
      setStatus(res?.brain ?? null);
      setLoaded(true);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [townId]);

  // 1Hz refresh of the relative-time label.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Town Brain</h3>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">10s poll</span>
      </header>
      <div className="p-4">
        {!loaded ? (
          <div className="text-center py-4 text-xs text-zinc-500">Loading brain status…</div>
        ) : !status ? (
          <div className="text-center py-4 text-xs text-zinc-500">
            Brain not wired yet. Active towns spin a brain on boot.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <Stat
              label="State"
              value={status.paused ? 'Paused' : status.running ? 'Running' : 'Stopped'}
              tone={status.paused ? 'warning' : status.running ? 'success' : 'muted'}
            />
            <Stat
              label="Last tick"
              value={status.lastTickAt == null ? '—' : timeAgo(status.lastTickAt)}
              tone="muted"
            />
            <Stat label="Ticks" value={String(status.ticks)} tone="muted" />
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'muted';
}) {
  const valueClass =
    tone === 'success'
      ? 'text-emerald-300'
      : tone === 'warning'
      ? 'text-amber-300'
      : 'text-zinc-200';
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
        {label}
      </span>
      <span className={`text-sm font-bold tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export default BrainStatusCard;
