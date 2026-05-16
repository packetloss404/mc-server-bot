/**
 * HighlightStream — in-memory ring buffer + rolling counters for town events.
 *
 * The external streaming platform (YouTube highlights pipeline) consumes
 * `town:event` socket frames and asks the API for "best of all towns" feeds
 * via /api/highlights and /api/streaming/health. This class is the small
 * cousin of EventLog focused on town events:
 *
 *   - record(event)      — push to the ring buffer + bump the per-minute
 *                          counter. Called from the API-layer hook wired
 *                          into TownManager.setEventEmitter().
 *   - topAcrossTowns()   — cross-town highlight query, sorted by
 *                          highlightScore DESC then occurredAt DESC. Used by
 *                          /api/highlights for the streamer feed.
 *   - getStats()         — rolling counters for /api/streaming/health.
 *
 * Persistence is intentionally a follow-up. The ring resets on restart and
 * the streamer is expected to also be reading from the SQLite events table
 * (via /api/towns/:id/highlights) for the durable history.
 */

import type { TownEvent } from './Town';

export interface HighlightItem {
  townId: string;
  townName: string;
  kind: string;
  severity: string | null;
  payload: unknown;
  occurredAt: number;
  highlightScore: number;
}

export interface HighlightStats {
  wsConnected: number;
  eventsPerMin: number;
  lastEventAt: number;
  avgHighlightScore: number;
}

export interface HighlightStreamOptions {
  /** Ring buffer capacity. Defaults to 500 events. */
  maxSize?: number;
  /** Window (ms) for the events-per-minute counter. Defaults to 60_000. */
  windowMs?: number;
  /**
   * Resolves a townId -> human-readable town name. The TownManager has the
   * authoritative list; this lookup is wired by the API layer so HighlightStream
   * stays free of TownManager coupling and remains trivially unit-testable.
   */
  resolveTownName?: (townId: string) => string | null;
  /**
   * Returns the count of currently-connected Socket.IO clients. Wired by the
   * API layer (it owns the io instance). Returns 0 when not wired so
   * /api/streaming/health stays safe in test contexts.
   */
  getWsConnected?: () => number;
}

export class HighlightStream {
  private readonly buffer: TownEvent[] = [];
  private readonly timestamps: number[] = [];
  private readonly maxSize: number;
  private readonly windowMs: number;
  private resolveTownName: (townId: string) => string | null;
  private getWsConnectedFn: () => number;

  constructor(opts: HighlightStreamOptions = {}) {
    this.maxSize = opts.maxSize ?? 500;
    this.windowMs = opts.windowMs ?? 60_000;
    this.resolveTownName = opts.resolveTownName ?? (() => null);
    this.getWsConnectedFn = opts.getWsConnected ?? (() => 0);
  }

  /** Late-binding setter so the API layer can wire deps after construction. */
  setTownNameResolver(fn: (townId: string) => string | null): void {
    this.resolveTownName = fn;
  }

  /** Late-binding setter for the Socket.IO connection counter. */
  setWsConnectedProvider(fn: () => number): void {
    this.getWsConnectedFn = fn;
  }

  /**
   * Push a town event into the ring. Called from the TownManager emitter
   * hook after every successful (or fallback-routed) recordEvent insert.
   */
  record(event: TownEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
    const ts = Date.now();
    this.timestamps.push(ts);
    this.trimWindow(ts);
  }

  /**
   * Cross-town highlight query — sorted by highlightScore DESC, then
   * occurredAt DESC. Mirrors the `idx_events_town_highlight` shape so the
   * streamer's "best of all towns" feed is consistent between live (this
   * ring) and historical (SQLite via /api/towns/:id/highlights) sources.
   */
  topAcrossTowns(limit = 50, since = 0): HighlightItem[] {
    const filtered = this.buffer.filter(
      (e) => e.occurredAt > since && (e.highlightScore ?? 0) > 0,
    );
    filtered.sort((a, b) => {
      const sa = a.highlightScore ?? 0;
      const sb = b.highlightScore ?? 0;
      if (sb !== sa) return sb - sa;
      return b.occurredAt - a.occurredAt;
    });
    return filtered.slice(0, Math.max(0, limit)).map((e) => this.toItem(e));
  }

  /**
   * Rolling stats used by /api/streaming/health. avgHighlightScore is
   * computed over the entire ring buffer so a long-running town with mostly
   * routine events doesn't look like it's silent — the streamer wants the
   * "what's the average buzz" number, not the last-60s-only average.
   */
  getStats(): HighlightStats {
    const now = Date.now();
    this.trimWindow(now);
    const lastEventAt = this.buffer.length > 0
      ? this.buffer[this.buffer.length - 1]!.occurredAt
      : 0;
    let sum = 0;
    let n = 0;
    for (const e of this.buffer) {
      const score = e.highlightScore;
      if (score != null && Number.isFinite(score)) {
        sum += score;
        n += 1;
      }
    }
    const avg = n > 0 ? sum / n : 0;
    let wsConnected = 0;
    try {
      wsConnected = Math.max(0, Math.floor(this.getWsConnectedFn()));
    } catch {
      wsConnected = 0;
    }
    return {
      wsConnected,
      eventsPerMin: this.timestamps.length,
      lastEventAt,
      avgHighlightScore: Number(avg.toFixed(2)),
    };
  }

  /** Internal — drop counter entries older than the rolling window. */
  private trimWindow(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0]! < cutoff) {
      this.timestamps.shift();
    }
  }

  /** Internal — flatten a TownEvent + resolved town name into the DTO. */
  private toItem(event: TownEvent): HighlightItem {
    return {
      townId: event.townId,
      townName: this.resolveTownName(event.townId) ?? event.townId,
      kind: event.kind,
      severity: event.severity ?? null,
      payload: event.payload,
      occurredAt: event.occurredAt,
      highlightScore: event.highlightScore ?? 0,
    };
  }
}
