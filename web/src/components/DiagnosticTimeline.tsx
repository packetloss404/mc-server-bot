'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, type BotEvent } from '@/lib/api';

// ─── Event type config ───

const EVENT_TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  'bot:state':      { label: 'State Change',  color: '#3B82F6', icon: 'S' },
  'bot:task':       { label: 'Task',           color: '#10B981', icon: 'T' },
  'bot:spawn':      { label: 'Spawned',        color: '#F59E0B', icon: '+' },
  'bot:disconnect': { label: 'Disconnected',   color: '#EF4444', icon: '-' },
  'bot:error':      { label: 'Error',          color: '#EF4444', icon: '!' },
  'bot:command':    { label: 'Command',        color: '#8B5CF6', icon: 'C' },
  'bot:mission':    { label: 'Mission',        color: '#0EA5E9', icon: 'M' },
  'bot:override':   { label: 'Override',       color: '#F97316', icon: 'O' },
  'swarm:directive':{ label: 'Swarm',          color: '#A78BFA', icon: 'D' },
};

function getEventConfig(type: string) {
  return EVENT_TYPE_CONFIG[type] ?? { label: type, color: '#6B7280', icon: '?' };
}

// ─── Time helpers ───

type TimeRange = 'hour' | 'day' | 'all';

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  hour: 'Last Hour',
  day: 'Last 24h',
  all: 'All',
};

function getTimeRangeCutoff(range: TimeRange): number {
  if (range === 'all') return 0;
  const now = Date.now();
  if (range === 'hour') return now - 60 * 60 * 1000;
  return now - 24 * 60 * 60 * 1000;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

// ─── Component ───

interface DiagnosticTimelineProps {
  botName: string;
  accentColor: string;
}

export function DiagnosticTimeline({ botName, accentColor }: DiagnosticTimelineProps) {
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    try {
      const data = await api.getActivity(200, botName);
      setEvents(data.events);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [botName]);

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 5000);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  // Apply filters
  const cutoff = getTimeRangeCutoff(timeRange);
  const filteredEvents = events.filter((e) => {
    if (e.timestamp < cutoff) return false;
    if (typeFilter && e.type !== typeFilter) return false;
    return true;
  });

  // Unique event types for filter chips
  const eventTypes = Array.from(new Set(events.map((e) => e.type)));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filters row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Time range */}
        <div className="flex items-center bg-zinc-800/60 rounded-lg p-0.5 gap-0.5">
          {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                timeRange === range
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {TIME_RANGE_LABELS[range]}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-zinc-800" />

        {/* Type filter chips */}
        <button
          onClick={() => setTypeFilter(null)}
          className={`px-2 py-0.5 text-[10px] rounded-md transition-colors ${
            typeFilter === null
              ? 'bg-zinc-700 text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          All Types
        </button>
        {eventTypes.map((type) => {
          const cfg = getEventConfig(type);
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
              className="px-2 py-0.5 text-[10px] rounded-md transition-colors flex items-center gap-1"
              style={{
                color: typeFilter === type ? cfg.color : '#71717a',
                backgroundColor: typeFilter === type ? `${cfg.color}15` : 'transparent',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: cfg.color }}
              />
              {cfg.label}
            </button>
          );
        })}
      </div>

      {/* Event count */}
      <div className="text-[10px] text-zinc-600">
        {filteredEvents.length} event{filteredEvents.length !== 1 ? 's' : ''}
        {typeFilter && ` (filtered)`}
      </div>

      {/* Timeline */}
      {filteredEvents.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-xs text-zinc-600">No events in this time range</p>
        </div>
      ) : (
        <div className="relative">
          {/* Vertical line */}
          <div
            className="absolute left-[15px] top-3 bottom-3 w-px"
            style={{ backgroundColor: `${accentColor}20` }}
          />

          <div className="space-y-0.5">
            <AnimatePresence initial={false}>
              {filteredEvents.map((event, idx) => {
                const cfg = getEventConfig(event.type);
                const isExpanded = expandedId === idx;

                return (
                  <motion.div
                    key={`${event.timestamp}-${idx}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.15, delay: Math.min(idx * 0.02, 0.3) }}
                  >
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : idx)}
                      className="w-full text-left flex items-start gap-3 py-2 px-1 rounded-lg hover:bg-zinc-800/30 transition-colors group"
                    >
                      {/* Dot */}
                      <div className="relative z-10 shrink-0 mt-0.5">
                        <div
                          className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-[10px] font-bold border"
                          style={{
                            color: cfg.color,
                            backgroundColor: `${cfg.color}10`,
                            borderColor: `${cfg.color}30`,
                          }}
                        >
                          {cfg.icon}
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[10px] font-semibold uppercase tracking-wide"
                            style={{ color: cfg.color }}
                          >
                            {cfg.label}
                          </span>
                          <span className="text-[10px] text-zinc-600 tabular-nums">
                            {formatRelativeTime(event.timestamp)}
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 mt-0.5 truncate group-hover:text-zinc-300 transition-colors">
                          {event.description}
                        </p>

                        {/* Expanded details */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.15 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-2 p-2.5 bg-zinc-800/50 rounded-lg border border-zinc-700/30 space-y-1.5">
                                <DetailRow label="Time" value={formatTimestamp(event.timestamp)} />
                                <DetailRow label="Type" value={event.type} />
                                <DetailRow label="Bot" value={event.botName} />
                                <DetailRow label="Description" value={event.description} />
                                {event.metadata && Object.keys(event.metadata).length > 0 && (
                                  <div className="pt-1.5 border-t border-zinc-700/30">
                                    <span className="text-[9px] text-zinc-600 uppercase tracking-wider">Metadata</span>
                                    <div className="mt-1 space-y-1">
                                      {Object.entries(event.metadata).map(([key, value]) => (
                                        <DetailRow
                                          key={key}
                                          label={key}
                                          value={typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>

                      {/* Expand indicator */}
                      <div className="shrink-0 mt-1">
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className={`text-zinc-600 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </div>
                    </button>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] text-zinc-600 min-w-[70px] shrink-0">{label}</span>
      <span className="text-[10px] text-zinc-400 break-all">{value}</span>
    </div>
  );
}
