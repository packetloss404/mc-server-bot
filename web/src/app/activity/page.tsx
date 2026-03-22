'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, type BotEvent } from '@/lib/api';
import { EVENT_CONFIG } from '@/lib/constants';
import { PageHeader } from '@/components/PageHeader';

const EVENT_TYPES = [
  'all', 'bot:state', 'bot:task', 'bot:chat', 'bot:spawn',
  'bot:disconnect', 'bot:skill_learned', 'bot:death',
];

export default function ActivityPage() {
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    const load = () => {
      api.getActivity(200).then((data) => setEvents(data.events)).catch(() => {});
    };
    load();
    if (autoRefresh) {
      const interval = setInterval(load, 3000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const filtered = events.filter((e) => {
    if (typeFilter !== 'all' && e.type !== typeFilter) return false;
    if (filter && !e.botName.toLowerCase().includes(filter.toLowerCase()) && !e.description.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-5xl">
      <PageHeader title="Activity Feed" subtitle={`${filtered.length} events${filter || typeFilter !== 'all' ? ' (filtered)' : ''}`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              autoRefresh
                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
            {autoRefresh ? 'Live' : 'Paused'}
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
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-zinc-500">No activity{filter || typeFilter !== 'all' ? ' matching filters' : ' yet'}</p>
            {(filter || typeFilter !== 'all') && (
              <button
                onClick={() => { setFilter(''); setTypeFilter('all'); }}
                className="text-xs text-zinc-500 hover:text-zinc-300 mt-2 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {filtered.map((event, i) => {
              const config = EVENT_CONFIG[event.type];
              const color = config?.color ?? '#6B7280';
              const time = new Date(event.timestamp);
              return (
                <motion.div
                  key={`${event.timestamp}-${i}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.02, 0.5) }}
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
            })}
          </div>
        )}
      </div>
    </div>
  );
}
