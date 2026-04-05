'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, type BotEvent } from '@/lib/api';
import { EVENT_CONFIG } from '@/lib/constants';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonList, LoadingSpinner } from '@/components/SkeletonLoader';

export default function HistoryPage() {
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.getActivity(500)
      .then((data) => setEvents(data.events))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = filter
    ? events.filter((e) =>
        e.botName.toLowerCase().includes(filter.toLowerCase()) ||
        e.description.toLowerCase().includes(filter.toLowerCase()) ||
        e.type.toLowerCase().includes(filter.toLowerCase())
      )
    : events;

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-5xl">
      <PageHeader title="History" subtitle={`${filtered.length} events${filter ? ' (filtered)' : ''}`}>
        <div className="relative">
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
            placeholder="Search history..."
            className="bg-zinc-800/80 border border-zinc-700/50 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 w-64"
          />
        </div>
      </PageHeader>

      {loading ? (
        <SkeletonList count={8} />
      ) : filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40"
        >
          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <p className="text-sm text-zinc-500">{filter ? 'No events match your search' : 'No history yet'}</p>
          <p className="text-xs text-zinc-600 mt-1">
            {filter ? (
              <button onClick={() => setFilter('')} className="text-emerald-500 hover:text-emerald-400">Clear search</button>
            ) : 'Events will appear here as your bots perform actions'}
          </p>
        </motion.div>
      ) : (
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 divide-y divide-zinc-800/30">
          {filtered.map((event, i) => {
            const config = EVENT_CONFIG[event.type];
            const color = config?.color ?? '#6B7280';
            const time = new Date(event.timestamp);
            return (
              <motion.div
                key={`${event.timestamp}-${i}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i * 0.01, 0.3) }}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/20 transition-colors"
              >
                <span className="text-[11px] text-zinc-600 font-mono shrink-0 w-28 tabular-nums">
                  {time.toLocaleDateString()} {time.toLocaleTimeString()}
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
  );
}
