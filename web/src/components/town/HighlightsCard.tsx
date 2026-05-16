'use client';

import { useEffect, useState } from 'react';
import { api, type GlobalHighlightDTO } from '@/lib/api';

const POLL_MS = 30_000;
const DEFAULT_LIMIT = 10;

/**
 * Severity tone -> chip class. Matches the dashboard's zinc/amber palette
 * already used by ChronicleFeedCard, with amber/red accents for the rare
 * critical/major moments the streamer cares about.
 */
function severityClass(severity: string | null): string {
  switch (severity) {
    case 'critical':
      return 'bg-red-500/10 text-red-300 border border-red-500/20';
    case 'major':
      return 'bg-amber-500/10 text-amber-300 border border-amber-500/20';
    case 'minor':
      return 'bg-blue-500/10 text-blue-300 border border-blue-500/20';
    case 'info':
    default:
      return 'bg-zinc-800/80 text-zinc-300 border border-zinc-700/60';
  }
}

function scoreClass(score: number): string {
  if (score >= 80) return 'text-amber-300';
  if (score >= 60) return 'text-amber-400/80';
  if (score >= 40) return 'text-zinc-300';
  return 'text-zinc-500';
}

function timeAgo(ts: number): string {
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
 * Format the event payload as a short preview line. The streamer wants a
 * one-line glimpse of what the highlight is about — full payload inspection
 * lives in the per-town feed. Falls back to "—" for null/empty.
 */
function previewPayload(payload: unknown): string {
  if (payload == null) return '—';
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'number' || typeof payload === 'boolean') return String(payload);
  if (typeof payload !== 'object') return '—';
  try {
    const obj = payload as Record<string, unknown>;
    // Prefer human-meaningful fields if present.
    for (const key of ['name', 'text', 'title', 'reason', 'kind', 'childName', 'description']) {
      const v = obj[key];
      if (typeof v === 'string' && v.length > 0) {
        return v.length > 90 ? `${v.slice(0, 87)}…` : v;
      }
    }
    const json = JSON.stringify(payload);
    return json.length > 90 ? `${json.slice(0, 87)}…` : json;
  } catch {
    return '—';
  }
}

/**
 * HighlightsCard — Phase 8 streamer feed. Shows the top 10 cross-town
 * highlights from /api/highlights, polled every 30s. Sits at the top of the
 * /town page so the player (and any over-the-shoulder stream viewers)
 * immediately see what's stream-worthy across the whole world.
 */
export function HighlightsCard() {
  const [highlights, setHighlights] = useState<GlobalHighlightDTO[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.listGlobalHighlights({ limit: DEFAULT_LIMIT });
        if (cancelled) return;
        setHighlights(res.highlights);
      } catch {
        // ignore — next poll retries
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
  }, []);

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">Stream Highlights</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            Top {DEFAULT_LIMIT} across all towns · 30s poll · feeds the YouTube streamer
          </p>
        </div>
        <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-2 py-1 rounded border border-amber-500/20">
          Live
        </span>
      </header>

      <div className="divide-y divide-zinc-800/60 max-h-[420px] overflow-y-auto">
        {!loaded ? (
          <div className="px-4 py-10 text-center text-xs text-zinc-500">Loading highlights…</div>
        ) : highlights.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-zinc-500">
            No stream-worthy events yet. As towns evolve, the best moments will surface here.
          </div>
        ) : (
          highlights.map((h, idx) => (
            <HighlightRow key={`${h.townId}-${h.occurredAt}-${idx}`} highlight={h} />
          ))
        )}
      </div>
    </section>
  );
}

function HighlightRow({ highlight }: { highlight: GlobalHighlightDTO }) {
  return (
    <article className="px-4 py-2.5 hover:bg-zinc-800/30 transition-colors">
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${severityClass(
            highlight.severity,
          )}`}
        >
          {highlight.kind}
        </span>
        <span className="text-[11px] font-semibold text-zinc-300 truncate">
          {highlight.townName}
        </span>
        <span className={`ml-auto text-[10px] font-bold tabular-nums ${scoreClass(highlight.highlightScore)}`}>
          {highlight.highlightScore}
        </span>
      </div>
      <p className="text-xs text-zinc-400 leading-snug truncate">
        {previewPayload(highlight.payload)}
      </p>
      <div className="text-[10px] text-zinc-600 mt-0.5">{timeAgo(highlight.occurredAt)}</div>
    </article>
  );
}

export default HighlightsCard;
