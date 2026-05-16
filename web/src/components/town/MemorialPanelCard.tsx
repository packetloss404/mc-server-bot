'use client';

import { useEffect, useState } from 'react';
import { api, type TownDisasterDTO } from '@/lib/api';

interface Props {
  townId: string;
}

const POLL_MS = 30_000;
const DEFAULT_LIMIT = 25;

const KIND_LABELS: Record<string, string> = {
  raid: 'Raid',
  lava: 'Lava',
  lost_bot: 'Lost Bot',
  crash: 'Crash',
};

const KIND_TONE: Record<string, string> = {
  raid: 'bg-red-500/10 text-red-300 border border-red-500/20',
  lava: 'bg-orange-500/10 text-orange-300 border border-orange-500/20',
  lost_bot: 'bg-violet-500/10 text-violet-300 border border-violet-500/20',
  crash: 'bg-amber-500/10 text-amber-300 border border-amber-500/20',
};

const SEVERITY_LABEL: Record<string, string> = {
  minor: 'Minor',
  major: 'Major',
  critical: 'Critical',
  info: 'Info',
};

const SEVERITY_TONE: Record<string, string> = {
  minor: 'text-blue-400',
  major: 'text-amber-400',
  critical: 'text-red-400',
  info: 'text-zinc-400',
};

function kindMeta(kind: string): { label: string; tone: string } {
  return {
    label: KIND_LABELS[kind] ?? kind,
    tone: KIND_TONE[kind] ?? 'bg-zinc-800/80 text-zinc-300 border border-zinc-700/60',
  };
}

function severityMeta(sev: string | null): { label: string; tone: string } {
  const key = sev ?? 'info';
  return {
    label: SEVERITY_LABEL[key] ?? key,
    tone: SEVERITY_TONE[key] ?? 'text-zinc-500',
  };
}

function timeAgo(ts: number | null): string {
  if (!ts) return '—';
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

/**
 * MemorialPanelCard — Phase 5-A dashboard window into the Phoenix
 * self-healing loop. Lists every disaster filed for the town (kind badge,
 * severity, time) with a "View on map" link that hands off to the world
 * map page anchored on the Memorial Park monument.
 *
 * Polls /api/towns/:id/disasters every 30 seconds.
 */
export function MemorialPanelCard({ townId }: Props) {
  const [disasters, setDisasters] = useState<TownDisasterDTO[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.listTownDisasters(townId, { limit: DEFAULT_LIMIT });
        if (cancelled) return;
        setDisasters(res.disasters);
      } catch {
        // ignore — backend may be offline; the next poll retries.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [townId]);

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">Memorial Park</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            Disasters recorded by the Phoenix loop · 30s poll
          </p>
        </div>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
          {disasters.length} total
        </span>
      </header>

      <div className="divide-y divide-zinc-800/60 max-h-[420px] overflow-y-auto">
        {!loaded ? (
          <div className="px-4 py-10 text-center text-xs text-zinc-500">Loading disasters…</div>
        ) : disasters.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-zinc-500">
            No disasters yet. May the streets stay quiet.
          </div>
        ) : (
          disasters.map((d) => <DisasterRow key={d.id} disaster={d} />)
        )}
      </div>
    </section>
  );
}

function DisasterRow({ disaster }: { disaster: TownDisasterDTO }) {
  const kind = kindMeta(disaster.kind);
  const severity = severityMeta(disaster.severity);
  const mapHref = disaster.memorialMarkerId
    ? `/map?marker=${encodeURIComponent(disaster.memorialMarkerId)}`
    : null;
  return (
    <article className="px-4 py-3 hover:bg-zinc-800/20 transition-colors">
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${kind.tone}`}
        >
          {kind.label}
        </span>
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${severity.tone}`}>
          {severity.label}
        </span>
        <span className="text-[10px] text-zinc-500 ml-auto">{timeAgo(disaster.occurredAt)}</span>
      </div>
      {disaster.summary && (
        <p className="text-xs text-zinc-300 leading-relaxed">{disaster.summary}</p>
      )}
      <div className="mt-1.5 flex items-center gap-3 text-[10px] text-zinc-500">
        {mapHref ? (
          <a
            href={mapHref}
            className="text-emerald-400 hover:text-emerald-300 transition-colors font-semibold"
          >
            View on map →
          </a>
        ) : (
          <span className="text-zinc-600">No monument yet</span>
        )}
        <span className="font-mono text-zinc-700">{disaster.id}</span>
      </div>
    </article>
  );
}

export default MemorialPanelCard;
