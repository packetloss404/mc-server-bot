'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ChronicleEntryDTO } from '@/lib/api';
import { useToast } from '@/components/Toast';

interface Props {
  townId: string;
}

const POLL_MS = 60_000;
const DEFAULT_LIMIT = 7;

const KIND_META: Record<string, { label: string; tone: 'daily' | 'milestone' | 'disaster' | 'voice' }> = {
  daily:     { label: 'Daily',     tone: 'daily' },
  milestone: { label: 'Milestone', tone: 'milestone' },
  disaster:  { label: 'Disaster',  tone: 'disaster' },
  voice:     { label: 'Journal',   tone: 'voice' },
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? { label: kind, tone: 'daily' as const };
}

function badgeClass(tone: 'daily' | 'milestone' | 'disaster' | 'voice'): string {
  // Match the dashboard's zinc/amber palette — amber accents for the rare
  // entries (milestones / disasters), zinc/emerald for the steady stream.
  switch (tone) {
    case 'milestone':
      return 'bg-amber-500/10 text-amber-300 border border-amber-500/20';
    case 'disaster':
      return 'bg-red-500/10 text-red-300 border border-red-500/20';
    case 'voice':
      return 'bg-cyan-500/10 text-cyan-300 border border-cyan-500/20';
    case 'daily':
    default:
      return 'bg-zinc-800/80 text-zinc-300 border border-zinc-700/60';
  }
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
 * Chronicle Feed — the dashboard's window into the LLM-narrated daily story
 * stream produced by Phase 4-B's ChronicleGenerator. Polls
 * /api/towns/:id/chronicle every 60s and shows the last 7 entries with their
 * day number, kind badge, and prose body.
 */
export function ChronicleFeedCard({ townId }: Props) {
  const { toast } = useToast();
  const [entries, setEntries] = useState<ChronicleEntryDTO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);

  const refresh = useCallback(async () => {
    const res = await api.listTownChronicle(townId, { limit: DEFAULT_LIMIT });
    setEntries(res.entries);
    setLoaded(true);
  }, [townId]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.listTownChronicle(townId, { limit: DEFAULT_LIMIT });
        if (cancelled) return;
        setEntries(res.entries);
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

  const handleGenerateNow = async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const res = await api.generateChronicleNow(townId, { force: true });
      if (res.entry) {
        toast(`Chronicled Day ${res.entry.dayNumber}`, 'success');
      } else if (res.reason === 'budget_capped') {
        toast(`Day ${res.dayNumber ?? '?'} skipped — budget cap reached`, 'info');
      } else {
        toast('Generation completed', 'info');
      }
      await refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to generate chronicle';
      toast(msg, 'error');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">Chronicle Feed</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            Last {DEFAULT_LIMIT} narrative entries · 60s poll
          </p>
        </div>
        <button
          type="button"
          onClick={handleGenerateNow}
          disabled={generating}
          title="Force-regenerate today's chronicle entry."
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition-colors disabled:opacity-60 disabled:cursor-wait"
        >
          {generating ? 'Working…' : 'Generate now'}
        </button>
      </header>

      <div className="divide-y divide-zinc-800/60 max-h-[520px] overflow-y-auto">
        {!loaded ? (
          <div className="px-4 py-10 text-center text-xs text-zinc-500">Loading chronicle…</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-zinc-500">
            No chronicle entries yet. The chronicler writes one per Minecraft day —
            check back in 20 minutes, or hit Generate now.
          </div>
        ) : (
          entries.map((entry) => <ChronicleRow key={entry.id} entry={entry} />)
        )}
      </div>
    </section>
  );
}

function ChronicleRow({ entry }: { entry: ChronicleEntryDTO }) {
  const meta = kindMeta(entry.kind);
  return (
    <article className="px-4 py-3 hover:bg-zinc-800/20 transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[11px] font-bold text-amber-300 tabular-nums">
          Day {entry.dayNumber}
        </span>
        <span
          className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${badgeClass(meta.tone)}`}
        >
          {meta.label}
        </span>
        <span className="text-[10px] text-zinc-500 ml-auto">{timeAgo(entry.generatedAt)}</span>
      </div>
      <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
        {entry.body}
      </p>
      {entry.model && (
        <p className="text-[9px] text-zinc-600 uppercase tracking-wider mt-2">
          via {entry.model}
        </p>
      )}
    </article>
  );
}

export default ChronicleFeedCard;
