'use client';

/**
 * AgentOps-style waterfall timeline of every LLM call for one bot.
 *
 * Bars are positioned by start/end time on a horizontal time axis (5-minute
 * window by default, sliding forward as new calls arrive). Color encodes the
 * task type, so a glance shows whether the bot is spending its budget on
 * codegen vs. curriculum vs. critic vs. chat vs. embed.
 *
 * Updates live via the `llm:call` Socket.IO event emitted by ModelRouter on
 * every dispatch (success or failure).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type LLMTraceEntry } from '@/lib/api';
import { getSocket } from '@/lib/socket';

interface Props {
  botName: string;
  /** Sliding window in ms. Defaults to 5 minutes. */
  windowMs?: number;
  /** Max bars kept in memory (older entries scroll off the left edge). */
  maxEntries?: number;
}

interface PalEntry {
  bg: string;
  border: string;
  fg: string;
}

const TASK_PALETTE: Record<string, PalEntry> = {
  codegen:    { bg: '#3B82F6', border: '#60A5FA', fg: '#DBEAFE' }, // blue
  curriculum: { bg: '#8B5CF6', border: '#A78BFA', fg: '#EDE9FE' }, // violet
  critic:     { bg: '#14B8A6', border: '#5EEAD4', fg: '#CCFBF1' }, // teal
  chat:       { bg: '#F59E0B', border: '#FBBF24', fg: '#FEF3C7' }, // amber
  embed:      { bg: '#71717A', border: '#A1A1AA', fg: '#E4E4E7' }, // zinc
  unknown:    { bg: '#52525B', border: '#71717A', fg: '#D4D4D8' },
};

function palette(taskType: string): PalEntry {
  return TASK_PALETTE[taskType] ?? TASK_PALETTE.unknown;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

export function LLMTraceTimeline({ botName, windowMs = 5 * 60_000, maxEntries = 200 }: Props) {
  const [entries, setEntries] = useState<LLMTraceEntry[]>([]);
  const [selected, setSelected] = useState<LLMTraceEntry | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Re-render every second so the sliding window advances even when there are
  // no new entries (otherwise bars would freeze in place).
  const [now, setNow] = useState(() => Date.now());

  // Track latest props in refs so the socket handler always uses fresh values.
  const botNameRef = useRef(botName);
  botNameRef.current = botName;
  const maxRef = useRef(maxEntries);
  maxRef.current = maxEntries;

  // Initial fetch + reset whenever the bot changes.
  useEffect(() => {
    let cancelled = false;
    api.getBotLLMTrace(botName, 100).then((data) => {
      if (cancelled) return;
      setEntries(data.trace.slice(-maxEntries));
      setSelected(null);
    });
    return () => { cancelled = true; };
  }, [botName, maxEntries]);

  // Live updates via Socket.IO.
  useEffect(() => {
    const socket = getSocket();
    const onCall = (raw: any) => {
      if (!raw || raw.botName !== botNameRef.current) return;
      const entry: LLMTraceEntry = {
        id: raw.id,
        taskType: String(raw.taskType ?? 'unknown'),
        provider: String(raw.provider ?? ''),
        model: String(raw.model ?? ''),
        startMs: Number(raw.startMs),
        endMs: Number(raw.endMs),
        durationMs: Number(raw.durationMs ?? Math.max(0, (raw.endMs ?? 0) - (raw.startMs ?? 0))),
        inputTokens: Number(raw.inputTokens ?? 0),
        outputTokens: Number(raw.outputTokens ?? 0),
        success: Boolean(raw.success),
        error: raw.error,
      };
      setEntries((prev) => {
        const next = [...prev, entry];
        return next.length > maxRef.current ? next.slice(-maxRef.current) : next;
      });
    };
    socket.on('llm:call', onCall);
    return () => { socket.off('llm:call', onCall); };
  }, []);

  // Tick the sliding window forward every second.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Compute window bounds. Anchor the right edge on the latest activity, but
  // never drift earlier than `now - windowMs` so the timeline stays current
  // when the bot is idle.
  const { windowStart, windowEnd, ticks } = useMemo(() => {
    const lastEnd = entries.length > 0 ? Math.max(...entries.map((e) => e.endMs)) : now;
    const windowEnd = Math.max(now, lastEnd);
    const windowStart = windowEnd - windowMs;
    // Build ~6 tick marks across the window
    const tickCount = 6;
    const ticks: { x: number; label: string }[] = [];
    for (let i = 0; i <= tickCount; i++) {
      const t = windowStart + (windowMs * i) / tickCount;
      ticks.push({ x: (i / tickCount) * 100, label: formatClock(t) });
    }
    return { windowStart, windowEnd, ticks };
  }, [entries, now, windowMs]);

  // Lay out bars in lanes so overlapping calls don't stack on the same row.
  // Greedy: assign each entry the lowest lane whose previous bar ends before
  // this one starts. Sort first so we lay out chronologically.
  const lanes = useMemo(() => {
    const sorted = [...entries].sort((a, b) => a.startMs - b.startMs);
    const laneEnd: number[] = [];
    const result: Array<{ entry: LLMTraceEntry; lane: number }> = [];
    for (const e of sorted) {
      let lane = laneEnd.findIndex((end) => end <= e.startMs);
      if (lane === -1) {
        lane = laneEnd.length;
        laneEnd.push(e.endMs);
      } else {
        laneEnd[lane] = e.endMs;
      }
      result.push({ entry: e, lane });
    }
    return { items: result, laneCount: Math.max(1, laneEnd.length) };
  }, [entries]);

  const LANE_HEIGHT = 18;
  const LANE_GAP = 4;
  const timelineHeight = lanes.laneCount * (LANE_HEIGHT + LANE_GAP) + 4;

  // Counts by task type for the legend.
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const e of entries) c[e.taskType] = (c[e.taskType] ?? 0) + 1;
    return c;
  }, [entries]);

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          LLM Trace Timeline
        </h2>
        <div className="flex items-center gap-3 text-[10px] text-zinc-500">
          <span className="tabular-nums">{entries.length} call{entries.length === 1 ? '' : 's'}</span>
          <span className="text-zinc-700">·</span>
          <span>last {Math.round(windowMs / 60_000)}m</span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-2">
        {(['codegen', 'curriculum', 'critic', 'chat', 'embed'] as const).map((t) => {
          const pal = palette(t);
          const n = counts[t] ?? 0;
          return (
            <div key={t} className="flex items-center gap-1.5 text-[10px] text-zinc-400">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: pal.bg, border: `1px solid ${pal.border}` }}
              />
              <span className="capitalize">{t}</span>
              {n > 0 && <span className="text-zinc-600 tabular-nums">{n}</span>}
            </div>
          );
        })}
      </div>

      {/* Timeline */}
      <div className="relative bg-zinc-950/60 border border-zinc-800/40 rounded-lg p-2 overflow-hidden">
        {entries.length === 0 ? (
          <div className="text-[10px] text-zinc-600 text-center py-8">
            No LLM calls in the last {Math.round(windowMs / 60_000)} minutes
          </div>
        ) : (
          <>
            {/* Tick grid */}
            <div className="relative h-3 mb-1">
              {ticks.map((tick, i) => (
                <div
                  key={i}
                  className="absolute top-0 text-[8px] text-zinc-600 tabular-nums"
                  style={{ left: `${tick.x}%`, transform: 'translateX(-50%)' }}
                >
                  {tick.label}
                </div>
              ))}
            </div>
            <div
              className="relative"
              style={{ height: timelineHeight }}
            >
              {/* Vertical tick lines */}
              {ticks.map((tick, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-zinc-800/40"
                  style={{ left: `${tick.x}%` }}
                />
              ))}
              {/* Bars */}
              {lanes.items.map(({ entry, lane }) => {
                const span = windowEnd - windowStart;
                if (span <= 0) return null;
                // Clip to visible window
                const visibleStart = Math.max(entry.startMs, windowStart);
                const visibleEnd = Math.min(entry.endMs, windowEnd);
                if (visibleEnd <= windowStart || visibleStart >= windowEnd) return null;
                const leftPct = ((visibleStart - windowStart) / span) * 100;
                const widthPct = Math.max(0.4, ((visibleEnd - visibleStart) / span) * 100);
                const pal = palette(entry.taskType);
                const isSelected = selected?.id === entry.id;
                const isHover = hoverId === entry.id;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onMouseEnter={() => setHoverId(entry.id)}
                    onMouseLeave={() => setHoverId((cur) => (cur === entry.id ? null : cur))}
                    onClick={() => setSelected(entry)}
                    className="absolute rounded-sm transition-all focus:outline-none"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      top: lane * (LANE_HEIGHT + LANE_GAP),
                      height: LANE_HEIGHT,
                      backgroundColor: pal.bg,
                      border: `1px solid ${isSelected || isHover ? pal.fg : pal.border}`,
                      opacity: entry.success ? 1 : 0.55,
                      boxShadow: isSelected ? `0 0 0 1px ${pal.fg}` : undefined,
                      cursor: 'pointer',
                    }}
                    aria-label={`${entry.taskType} call to ${entry.provider}, ${formatMs(entry.durationMs)}`}
                  >
                    {!entry.success && (
                      <span
                        className="absolute inset-0 flex items-center justify-center text-[8px] font-bold"
                        style={{ color: pal.fg }}
                      >
                        ×
                      </span>
                    )}
                  </button>
                );
              })}
              {/* Hover tooltip */}
              {hoverId && (() => {
                const e = entries.find((x) => x.id === hoverId);
                if (!e) return null;
                const span = windowEnd - windowStart;
                const visibleStart = Math.max(e.startMs, windowStart);
                const leftPct = ((visibleStart - windowStart) / span) * 100;
                const lane = lanes.items.find((it) => it.entry.id === hoverId)?.lane ?? 0;
                // Flip the tooltip to the left edge of the bar if it would
                // overflow off the right side of the timeline.
                const flipLeft = leftPct > 60;
                return (
                  <div
                    className="absolute z-10 pointer-events-none bg-zinc-950 border border-zinc-700 rounded-md px-2 py-1.5 text-[10px] shadow-xl whitespace-nowrap"
                    style={{
                      left: flipLeft ? undefined : `calc(${leftPct}% + 4px)`,
                      right: flipLeft ? `calc(${100 - leftPct}% + 4px)` : undefined,
                      top: lane * (LANE_HEIGHT + LANE_GAP) + LANE_HEIGHT + 4,
                    }}
                  >
                    <div className="font-semibold text-zinc-200 capitalize">{e.taskType}</div>
                    <div className="text-zinc-400">{e.provider} · {e.model || 'unknown'}</div>
                    <div className="text-zinc-400 tabular-nums">
                      {formatMs(e.durationMs)} · {e.inputTokens}→{e.outputTokens} tok
                    </div>
                    <div className={e.success ? 'text-emerald-400' : 'text-red-400'}>
                      {e.success ? 'success' : 'failed'}
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}
      </div>

      {/* Detail side panel (inline) */}
      {selected && (
        <div className="mt-3 bg-zinc-950/80 border border-zinc-800/60 rounded-lg p-3 text-[11px] space-y-1.5">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: palette(selected.taskType).bg }}
              />
              <span className="text-zinc-200 font-semibold capitalize">{selected.taskType}</span>
              <span
                className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  selected.success
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'bg-red-500/15 text-red-400'
                }`}
              >
                {selected.success ? 'success' : 'failed'}
              </span>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="text-zinc-600 hover:text-zinc-300"
              aria-label="Close details"
            >
              ×
            </button>
          </div>
          <Row label="Provider" value={selected.provider || '—'} />
          <Row label="Model" value={selected.model || '—'} />
          <Row label="Started" value={`${formatClock(selected.startMs)}.${String(selected.startMs % 1000).padStart(3, '0')}`} />
          <Row label="Duration" value={formatMs(selected.durationMs)} />
          <Row label="Tokens" value={`${selected.inputTokens} in → ${selected.outputTokens} out`} />
          <Row label="ID" value={selected.id} mono />
          {selected.error && <Row label="Error" value={selected.error} mono />}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-zinc-500 w-16 shrink-0">{label}</span>
      <span className={`text-zinc-300 truncate ${mono ? 'font-mono text-[10px]' : ''}`}>{value}</span>
    </div>
  );
}
