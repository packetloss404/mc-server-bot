'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '@/lib/api';

const MAX_LINES = 500;

export interface LogStreamProps {
  /** Optional override for the SSE endpoint path. */
  path?: string;
}

/**
 * Live log viewer — subscribes to /api/admin/logs/stream (SSE), keeps the last
 * ~500 lines in memory, auto-scrolls to the bottom unless the user has scrolled
 * up, and exposes Pause / Resume / Clear controls.
 */
export function LogStream({ path = '/api/admin/logs/stream' }: LogStreamProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  const bufferRef = useRef<string[]>([]);
  const pausedRef = useRef(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep a ref synced with the paused state so the SSE handler (which captures
  // a stable closure) can see live updates without re-subscribing.
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Flush buffered incoming lines into state at most every ~100ms — keeps React
  // from re-rendering on every log line in a high-throughput burst.
  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) return;
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      if (pausedRef.current) return;
      const incoming = bufferRef.current;
      if (incoming.length === 0) return;
      bufferRef.current = [];
      setLines((prev) => {
        const merged = prev.concat(incoming);
        return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
      });
    }, 100);
  }, []);

  useEffect(() => {
    const url = `${API_BASE}${path}`;
    let source: EventSource | null = null;
    try {
      source = new EventSource(url);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to open EventSource');
      return;
    }

    source.onopen = () => {
      setConnected(true);
      setError(null);
    };
    source.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== 'string' || ev.data.length === 0) return;
      bufferRef.current.push(ev.data);
      if (bufferRef.current.length > MAX_LINES * 2) {
        bufferRef.current.splice(0, bufferRef.current.length - MAX_LINES);
      }
      scheduleFlush();
    };
    source.onerror = () => {
      setConnected(false);
      // Browser will auto-reconnect; surface a hint but keep the stream alive.
      setError('Stream disconnected — retrying…');
    };

    return () => {
      source?.close();
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
    };
  }, [path, scheduleFlush]);

  // Auto-scroll to bottom whenever new lines arrive, unless user scrolled up.
  useEffect(() => {
    if (!followRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const dist = el.scrollHeight - (el.scrollTop + el.clientHeight);
    followRef.current = dist < 40;
  }, []);

  const togglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p;
      pausedRef.current = next;
      // On resume, flush whatever's in the buffer right away.
      if (!next && bufferRef.current.length > 0) {
        const incoming = bufferRef.current;
        bufferRef.current = [];
        setLines((prev) => {
          const merged = prev.concat(incoming);
          return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
        });
      }
      return next;
    });
  }, []);

  const handleClear = useCallback(() => {
    setLines([]);
    bufferRef.current = [];
  }, []);

  const handleJumpToBottom = useCallback(() => {
    followRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div className="flex flex-col h-full bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800/60 bg-zinc-950/40">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-zinc-600'}`}
            aria-label={connected ? 'connected' : 'disconnected'}
          />
          <span className={connected ? 'text-zinc-300' : 'text-zinc-500'}>
            {connected ? 'Live' : (error ?? 'Connecting…')}
          </span>
          <span className="text-[10px] text-zinc-600 ml-2 tabular-nums">{lines.length} lines</span>
          {paused && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-semibold uppercase tracking-wider">
              Paused
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={togglePause}
            className="px-2.5 py-1 text-[11px] rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 text-zinc-200 transition-colors"
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={handleClear}
            className="px-2.5 py-1 text-[11px] rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 text-zinc-200 transition-colors"
          >
            Clear
          </button>
          <button
            onClick={handleJumpToBottom}
            className="px-2.5 py-1 text-[11px] rounded-md bg-zinc-800/80 hover:bg-zinc-700/80 border border-zinc-700/60 text-zinc-200 transition-colors"
            title="Jump to latest"
          >
            Bottom
          </button>
        </div>
      </div>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed bg-black/40 text-zinc-300 whitespace-pre-wrap"
      >
        {lines.length === 0 ? (
          <div className="text-zinc-600 italic">Waiting for log output…</div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="break-words">
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default LogStream;
