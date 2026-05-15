import type { BotEvent } from './api';

/** Sliding window for grouping similar events (5 minutes). */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * A group of similar events sharing the same fingerprint within the sliding window.
 * `events` is sorted oldest→newest so that `events[0]` is the first occurrence
 * and `events[events.length - 1]` is the latest.
 */
export interface ActivityGroup {
  fingerprint: string;
  type: string;
  /** Most-recent event in the group — used for description display. */
  latest: BotEvent;
  /** First event in the group — used for the displayed timestamp. */
  first: BotEvent;
  /** Deduped bot names that appear in this group, in insertion order. */
  bots: string[];
  /** Total events in this group (always >= 1). */
  count: number;
  /** All raw events in the group, ordered oldest→newest. */
  events: BotEvent[];
}

/**
 * Strip bot names + coordinates from an error string so similar errors collapse
 * into one fingerprint. Coordinates look like `(12, 64, -8)` or `at 12,64,-8`.
 */
function normalizeErrorPattern(raw: string, knownBots: Iterable<string>): string {
  let s = raw.split(/[.!?\n]/, 1)[0] ?? raw;
  s = s.toLowerCase().trim();

  // Strip parenthesised or bare coordinate triples.
  s = s.replace(/\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g, '');
  s = s.replace(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/g, '');
  // Strip standalone numbers (often counts or coords) — keep words intact.
  s = s.replace(/\b-?\d+(?:\.\d+)?\b/g, '#');

  for (const bot of knownBots) {
    if (!bot) continue;
    const escaped = bot.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\b${escaped}\\b`, 'g'), '');
  }

  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Derive a stable fingerprint string for an event. Events sharing a fingerprint
 * within the sliding window are collapsed into a single row.
 */
export function fingerprintEvent(event: BotEvent, knownBots: Iterable<string> = []): string {
  const md = (event.metadata ?? {}) as Record<string, unknown>;

  if (event.type === 'bot:state') {
    const from = String(md.from ?? md.previous ?? '').toUpperCase();
    const to = String(md.to ?? md.next ?? md.state ?? '').toUpperCase();
    return `bot:state|${from}->${to}`;
  }

  if (event.type === 'task:failed') {
    const taskDesc = String(md.taskDesc ?? md.task ?? md.description ?? '').toLowerCase().trim();
    const errRaw = String(md.error ?? md.reason ?? event.description ?? '');
    const errPattern = normalizeErrorPattern(errRaw, knownBots);
    return `task:failed|${taskDesc}|${errPattern}`;
  }

  if (event.type === 'bot:died' || event.type === 'bot:death') {
    return `${event.type}|${(event.botName ?? '').toLowerCase()}`;
  }

  const descKey = (event.description ?? '').slice(0, 60).toLowerCase().trim();
  return `${event.type}|${descKey}`;
}

/**
 * Group a list of events (newest-first, as stored) by fingerprint within a
 * sliding 5-minute window. Returns groups sorted newest-first by their latest
 * occurrence so the most recent activity stays at the top.
 */
export function groupEvents(events: BotEvent[], knownBots: Iterable<string> = []): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  const openByFingerprint = new Map<string, ActivityGroup>();

  // Walk oldest→newest so timestamps within each group go in natural order.
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp);

  for (const event of ordered) {
    const fp = fingerprintEvent(event, knownBots);
    const open = openByFingerprint.get(fp);

    if (open && event.timestamp - open.first.timestamp <= GROUP_WINDOW_MS) {
      open.events.push(event);
      open.latest = event;
      open.count += 1;
      const botKey = event.botName ?? '';
      if (botKey && !open.bots.includes(botKey)) open.bots.push(botKey);
      continue;
    }

    const fresh: ActivityGroup = {
      fingerprint: fp,
      type: event.type,
      first: event,
      latest: event,
      bots: event.botName ? [event.botName] : [],
      count: 1,
      events: [event],
    };
    groups.push(fresh);
    openByFingerprint.set(fp, fresh);
  }

  groups.sort((a, b) => b.latest.timestamp - a.latest.timestamp);
  return groups;
}

/** Render a deduped bots list, truncated at 5 with "+N more". */
export function formatBotsList(bots: string[], max = 5): string {
  if (bots.length === 0) return '';
  if (bots.length <= max) return bots.join(', ');
  return `${bots.slice(0, max).join(', ')} +${bots.length - max} more`;
}
