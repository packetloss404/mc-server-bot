'use client';

import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBotDecisions } from '@/lib/useBotDecisions';
import type { DecisionRecord } from '@/lib/store';

// ─── Type styling ──────────────────────────────────────────────────────────

interface TypeStyle {
  label: string;
  /** Tailwind text color class for the type pill. */
  text: string;
  /** Tailwind border color class for the row's left rail / pill border. */
  border: string;
  /** Tailwind background tint class for the pill (low opacity). */
  bg: string;
  /** Solid color for the timeline dot. */
  dot: string;
}

const TYPE_STYLES: Record<string, TypeStyle> = {
  task_selection: {
    label: 'task selection',
    text: 'text-blue-300',
    border: 'border-blue-500/40',
    bg: 'bg-blue-500/10',
    dot: 'bg-blue-400',
  },
  action: {
    label: 'action',
    text: 'text-zinc-300',
    border: 'border-zinc-600/50',
    bg: 'bg-zinc-700/30',
    dot: 'bg-zinc-400',
  },
  replan: {
    label: 'replan',
    text: 'text-amber-300',
    border: 'border-amber-500/40',
    bg: 'bg-amber-500/10',
    dot: 'bg-amber-400',
  },
};

/** Map any backend trace type onto our three display buckets. */
function styleForType(type: string): TypeStyle {
  if (type === 'task_selection') return TYPE_STYLES.task_selection;
  if (
    type === 'retry_decision' ||
    type === 'replan' ||
    type === 'task_outcome' ||
    type === 'critic_evaluation'
  ) {
    return TYPE_STYLES.replan;
  }
  return TYPE_STYLES.action;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function decisionAction(r: DecisionRecord): string {
  return r.action ?? r.decision ?? r.summary ?? '(no action)';
}

function decisionReason(r: DecisionRecord): string {
  return r.reason ?? r.summary ?? '';
}

function fingerprint(r: DecisionRecord): string {
  // Sentry-style: group by type + action + reason. Whitespace-collapse so
  // trivial wording variants don't break the group.
  const action = decisionAction(r).trim().toLowerCase().replace(/\s+/g, ' ');
  const reason = decisionReason(r).trim().toLowerCase().replace(/\s+/g, ' ');
  return `${r.type}|${action}|${reason}`;
}

interface DisplayGroup {
  key: string;
  fingerprint: string;
  /** Newest member used as the representative for the collapsed row. */
  head: DecisionRecord;
  members: DecisionRecord[];
}

/**
 * groupDecisions — when 3+ adjacent decisions share the same fingerprint,
 * collapse them into a single DisplayGroup. 1-2 in a row are passed through
 * as their own groups so the timeline shows individual rows when nothing
 * is actually being repeated.
 */
function groupDecisions(records: DecisionRecord[]): DisplayGroup[] {
  const out: DisplayGroup[] = [];
  let i = 0;
  while (i < records.length) {
    const fp = fingerprint(records[i]);
    let j = i + 1;
    while (j < records.length && fingerprint(records[j]) === fp) j++;
    const run = records.slice(i, j);
    if (run.length >= 3) {
      out.push({
        key: `${run[0].id}-grp`,
        fingerprint: fp,
        head: run[0],
        members: run,
      });
    } else {
      for (const r of run) {
        out.push({ key: r.id, fingerprint: fp, head: r, members: [r] });
      }
    }
    i = j;
  }
  return out;
}

// ─── Component ─────────────────────────────────────────────────────────────

interface DecisionTimelineProps {
  botName: string;
  /** Optional className for the outer container. */
  className?: string;
}

export function DecisionTimeline({ botName, className }: DecisionTimelineProps) {
  const { decisions, loading } = useBotDecisions(botName);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const groups = useMemo(() => groupDecisions(decisions), [decisions]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-8 ${className ?? ''}`}>
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (decisions.length === 0) {
    return (
      <div className={`text-center py-8 ${className ?? ''}`}>
        <p className="text-xs text-zinc-500">No decisions yet — bot may be idle.</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className ?? ''}`}>
      {/* Vertical rail */}
      <div className="absolute left-[11px] top-3 bottom-3 w-px bg-zinc-800" />

      <div className="space-y-0.5">
        <AnimatePresence initial={false}>
          {groups.map((group) => {
            const style = styleForType(group.head.type);
            const isExpanded = expandedKey === group.key;
            const isGrouped = group.members.length > 1;
            const alternatives =
              group.head.alternatives ??
              (group.head.candidates
                ? group.head.candidates.filter((c) => !c.chosen)
                : undefined);
            const hasAlternatives = !!alternatives && alternatives.length > 0;
            const expandable = isGrouped || hasAlternatives;

            return (
              <motion.div
                key={group.key}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18 }}
              >
                <button
                  type="button"
                  onClick={() => expandable && setExpandedKey(isExpanded ? null : group.key)}
                  className={`w-full text-left flex items-start gap-3 py-2 pr-2 pl-1 rounded-md transition-colors ${
                    expandable ? 'hover:bg-zinc-800/40 cursor-pointer' : 'cursor-default'
                  }`}
                >
                  {/* Dot on the rail */}
                  <div className="relative z-10 shrink-0 mt-1">
                    <div className={`w-[10px] h-[10px] rounded-full ${style.dot} ring-2 ring-zinc-900`} />
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-semibold rounded border ${style.text} ${style.border} ${style.bg}`}
                      >
                        {style.label}
                      </span>
                      <span className="text-[10px] text-zinc-500 tabular-nums">
                        {formatTime(group.head.timestamp)}
                      </span>
                      {isGrouped && (
                        <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-zinc-700/60 text-zinc-200">
                          {group.members.length}x
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 text-xs text-zinc-200 truncate">
                      {isGrouped ? (
                        <>
                          Selected <span className="font-medium text-zinc-100">&apos;{decisionAction(group.head)}&apos;</span>{' '}
                          <span className="text-zinc-500">x {group.members.length}</span>
                        </>
                      ) : (
                        <>Selected <span className="font-medium text-zinc-100">&apos;{decisionAction(group.head)}&apos;</span></>
                      )}
                    </p>

                    {decisionReason(group.head) && (
                      <p className="mt-0.5 text-[11px] text-zinc-500 truncate">
                        {decisionReason(group.head)}
                      </p>
                    )}

                    {/* Expanded panel */}
                    <AnimatePresence>
                      {isExpanded && expandable && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-2 p-2.5 rounded-md bg-zinc-900/70 border border-zinc-800 space-y-2">
                            {group.head.target && (
                              <DetailRow label="Target" value={group.head.target} />
                            )}
                            {group.head.task && (
                              <DetailRow label="Task" value={group.head.task} />
                            )}
                            {hasAlternatives && alternatives && (
                              <div>
                                <span className="text-[9px] uppercase tracking-wider text-zinc-500">
                                  Alternatives considered
                                </span>
                                <ul className="mt-1 space-y-1">
                                  {alternatives.map((alt, idx) => (
                                    <li
                                      key={`${group.key}-alt-${idx}`}
                                      className="text-[11px] text-zinc-400 flex items-start gap-2"
                                    >
                                      <span className="text-zinc-600 shrink-0">•</span>
                                      <span className="min-w-0">
                                        <span className="text-zinc-300">{alt.label}</span>
                                        {alt.reason && (
                                          <span className="text-zinc-500"> — {alt.reason}</span>
                                        )}
                                        {typeof alt.score === 'number' && (
                                          <span className="text-zinc-600"> ({alt.score.toFixed(2)})</span>
                                        )}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {isGrouped && (
                              <div>
                                <span className="text-[9px] uppercase tracking-wider text-zinc-500">
                                  Run of {group.members.length}
                                </span>
                                <ul className="mt-1 space-y-0.5">
                                  {group.members.map((m) => (
                                    <li
                                      key={m.id}
                                      className="text-[10px] text-zinc-500 tabular-nums flex items-center gap-2"
                                    >
                                      <span>{formatTime(m.timestamp)}</span>
                                      <span className="text-zinc-700">·</span>
                                      <span className="text-zinc-400 truncate">
                                        {decisionAction(m)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Caret */}
                  {expandable && (
                    <div className="shrink-0 mt-1.5">
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className={`text-zinc-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  )}
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[9px] uppercase tracking-wider text-zinc-500 min-w-[56px] shrink-0 mt-0.5">
        {label}
      </span>
      <span className="text-[11px] text-zinc-300 break-all">{value}</span>
    </div>
  );
}
