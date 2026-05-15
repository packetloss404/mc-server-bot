'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useBotStore } from '@/lib/store';
import { EVENT_CONFIG } from '@/lib/constants';
import { PageHeader } from '@/components/PageHeader';
import { groupEvents, formatBotsList, type ActivityGroup } from '@/lib/activityFingerprint';
import type { BotEvent } from '@/lib/api';

const EVENT_TYPES = [
  'all', 'bot:state', 'bot:task', 'bot:chat', 'bot:spawn',
  'bot:disconnect', 'bot:skill_learned', 'bot:death', 'commander:parse', 'commander:execute',
];

export default function ActivityPage() {
  const events = useBotStore((s) => s.activityFeed);
  const botList = useBotStore((s) => s.botList);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [livePaused, setLivePaused] = useState(false);
  const [pausedEvents, setPausedEvents] = useState<typeof events>([]);
  // Persist the grouped-mode toggle across sessions. Read once on mount;
  // write on every change so the choice survives refresh.
  const [grouped, setGrouped] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem('activity:grouped');
    return stored === null ? true : stored === '1';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('activity:grouped', grouped ? '1' : '0');
  }, [grouped]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visibleEvents = useMemo(() => (livePaused ? pausedEvents : events), [events, livePaused, pausedEvents]);

  const filtered = useMemo(() => visibleEvents.filter((e) => {
    if (typeFilter !== 'all' && e.type !== typeFilter) return false;
    if (filter && !e.botName.toLowerCase().includes(filter.toLowerCase()) && !e.description.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  }), [visibleEvents, typeFilter, filter]);

  const knownBots = useMemo(() => botList.map((b) => b.name), [botList]);

  const groups = useMemo<ActivityGroup[]>(() => {
    if (!grouped) return [];
    return groupEvents(filtered, knownBots);
  }, [filtered, grouped, knownBots]);

  const toggleExpanded = (fp: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });
  };

  const totalCount = grouped ? groups.length : filtered.length;
  const isEmpty = totalCount === 0;
  const hasFilters = filter || typeFilter !== 'all';

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-5xl">
      <PageHeader title="Activity Feed" subtitle={`${totalCount} ${grouped ? 'groups' : 'events'}${hasFilters ? ' (filtered)' : ''}`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setGrouped((v) => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              grouped
                ? 'border-violet-500/30 text-violet-300 bg-violet-500/10'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {grouped ? 'Group similar' : 'Show all'}
          </button>
          <button
            onClick={() => {
              if (!livePaused) {
                setPausedEvents(events);
              }
              setLivePaused((value) => !value);
            }}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              !livePaused
                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${!livePaused ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
            {!livePaused ? 'Live' : 'Paused'}
          </button>
        </div>
      </PageHeader>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search events..."
            className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {EVENT_TYPES.map((type) => {
            const config = type === 'all' ? null : EVENT_CONFIG[type];
            return (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  typeFilter === type
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
                style={typeFilter === type && config ? { color: config.color, backgroundColor: `${config.color}15` } : undefined}
              >
                {type === 'all' ? 'All' : config?.label ?? type}
              </button>
            );
          })}
        </div>
      </div>

      {/* Event List */}
      <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 overflow-hidden">
        {isEmpty ? (
          <div className="py-16 text-center">
            <p className="text-sm text-zinc-500">{hasFilters ? 'No activity matching filters' : 'No activity yet'}</p>
            {hasFilters && (
              <button
                onClick={() => { setFilter(''); setTypeFilter('all'); }}
                className="text-xs text-zinc-500 hover:text-zinc-300 mt-2 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : grouped ? (
          <div className="divide-y divide-zinc-800/30">
            {groups.map((group, i) => (
              <GroupRow
                key={`${group.fingerprint}-${group.first.timestamp}`}
                group={group}
                index={i}
                expanded={expanded.has(group.fingerprint)}
                onToggle={() => toggleExpanded(group.fingerprint)}
              />
            ))}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {filtered.map((event, i) => (
              <EventRow key={`${event.timestamp}-${i}`} event={event} index={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event, index }: { event: BotEvent; index: number }) {
  const config = EVENT_CONFIG[event.type];
  const color = config?.color ?? '#6B7280';
  const time = new Date(event.timestamp);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index * 0.02, 0.5) }}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/20 transition-colors"
    >
      <span className="text-[11px] text-zinc-600 font-mono shrink-0 w-20 tabular-nums">
        {time.toLocaleTimeString()}
      </span>
      <span
        className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0"
        style={{ color, backgroundColor: `${color}12` }}
      >
        {config?.icon ?? '.'}
      </span>
      <span className="text-xs text-zinc-300 font-medium shrink-0 w-28 truncate">{event.botName}</span>
      <span className="text-xs text-zinc-500 flex-1 truncate">{event.description}</span>
      <span
        className="text-[10px] px-2 py-0.5 rounded font-medium shrink-0"
        style={{ color, backgroundColor: `${color}10` }}
      >
        {config?.label ?? event.type}
      </span>
    </motion.div>
  );
}

function GroupRow({
  group,
  index,
  expanded,
  onToggle,
}: {
  group: ActivityGroup;
  index: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const config = EVENT_CONFIG[group.type];
  const color = config?.color ?? '#6B7280';
  const firstTime = new Date(group.first.timestamp);
  const botsLabel = formatBotsList(group.bots);
  const isCollapsed = group.count > 1;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index * 0.02, 0.5) }}
      className="flex flex-col"
    >
      <button
        onClick={onToggle}
        disabled={!isCollapsed}
        className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors ${
          isCollapsed ? 'hover:bg-zinc-800/30 cursor-pointer' : 'cursor-default'
        }`}
      >
        <span className="text-[11px] text-zinc-600 font-mono shrink-0 w-20 tabular-nums">
          {firstTime.toLocaleTimeString()}
        </span>
        <span
          className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0"
          style={{ color, backgroundColor: `${color}12` }}
        >
          {config?.icon ?? '.'}
        </span>
        <span className="text-xs text-zinc-300 font-medium shrink-0 w-28 truncate" title={botsLabel}>
          {botsLabel || group.latest.botName}
        </span>
        <span className="text-xs text-zinc-500 flex-1 truncate">{group.latest.description}</span>
        {isCollapsed && (
          <span className="text-[10px] px-2 py-0.5 rounded font-semibold shrink-0 bg-zinc-700/60 text-zinc-200 tabular-nums">
            &times;&nbsp;{group.count}
          </span>
        )}
        <span
          className="text-[10px] px-2 py-0.5 rounded font-medium shrink-0"
          style={{ color, backgroundColor: `${color}10` }}
        >
          {config?.label ?? group.type}
        </span>
        {isCollapsed && (
          <span className={`text-[10px] text-zinc-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}>
            &rsaquo;
          </span>
        )}
      </button>
      {isCollapsed && expanded && (
        <div className="bg-zinc-950/40 border-t border-zinc-800/30 pl-[5.5rem] pr-4 py-2 space-y-1">
          {group.events.slice().reverse().map((ev, idx) => {
            const t = new Date(ev.timestamp);
            return (
              <div key={`${ev.timestamp}-${idx}`} className="flex items-center gap-3 text-[11px]">
                <span className="text-zinc-600 font-mono shrink-0 w-20 tabular-nums">
                  {t.toLocaleTimeString()}
                </span>
                <span className="text-zinc-400 shrink-0 w-28 truncate">{ev.botName}</span>
                <span className="text-zinc-500 flex-1 truncate">{ev.description}</span>
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
