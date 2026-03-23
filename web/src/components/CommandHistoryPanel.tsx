'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, type BotEvent } from '@/lib/api';
import { useBotStore } from '@/lib/store';

const STATUS_COLORS: Record<string, string> = {
  queued: '#F59E0B',
  started: '#3B82F6',
  succeeded: '#10B981',
  failed: '#EF4444',
  cancelled: '#6B7280',
};

const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  task_started: { label: 'Task', color: '#3B82F6' },
  task_completed: { label: 'Task', color: '#10B981' },
  task_failed: { label: 'Task', color: '#EF4444' },
  skill_executed: { label: 'Skill', color: '#8B5CF6' },
  movement: { label: 'Move', color: '#F59E0B' },
  chat: { label: 'Chat', color: '#EC4899' },
  action: { label: 'Action', color: '#06B6D4' },
  state_change: { label: 'State', color: '#6B7280' },
};

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getCommandStatus(type: string): string {
  if (type.includes('completed') || type.includes('succeeded')) return 'succeeded';
  if (type.includes('failed')) return 'failed';
  if (type.includes('started') || type.includes('running')) return 'started';
  if (type.includes('cancelled')) return 'cancelled';
  return 'queued';
}

interface Props {
  botName: string;
}

export function CommandHistoryPanel({ botName }: Props) {
  const [commands, setCommands] = useState<BotEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const activityFeed = useBotStore((s) => s.activityFeed);

  const fetchCommands = useCallback(async () => {
    try {
      // Try fetching command history from API
      const data = await api.getActivity(20, botName);
      setCommands(data.events);
    } catch {
      // Fallback to activity feed from store
      const filtered = activityFeed
        .filter((e) => e.botName.toLowerCase() === botName.toLowerCase())
        .slice(0, 20);
      setCommands(filtered);
    }
    setLoading(false);
  }, [botName, activityFeed]);

  useEffect(() => {
    fetchCommands();
    const interval = setInterval(fetchCommands, 8000);
    return () => clearInterval(interval);
  }, [fetchCommands]);

  // Also merge in live activity feed events for this bot
  useEffect(() => {
    const liveEvents = activityFeed.filter(
      (e) => e.botName.toLowerCase() === botName.toLowerCase()
    );
    if (liveEvents.length > 0) {
      setCommands((prev) => {
        const existingIds = new Set(prev.map((e) => `${e.type}-${e.timestamp}`));
        const newEvents = liveEvents.filter(
          (e) => !existingIds.has(`${e.type}-${e.timestamp}`)
        );
        if (newEvents.length === 0) return prev;
        return [...newEvents, ...prev].slice(0, 30);
      });
    }
  }, [activityFeed, botName]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full mb-2"
      >
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
          Command History
        </h2>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-zinc-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <div className="w-4 h-4 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
              </div>
            ) : commands.length === 0 ? (
              <p className="text-xs text-zinc-600 text-center py-3">No commands recorded</p>
            ) : (
              <div className="space-y-0.5 max-h-72 overflow-y-auto">
                {commands.map((cmd, i) => {
                  const status = getCommandStatus(cmd.type);
                  const statusColor = STATUS_COLORS[status] || '#6B7280';
                  const typeInfo = EVENT_TYPE_LABELS[cmd.type] || { label: cmd.type.replace(/_/g, ' '), color: '#6B7280' };

                  return (
                    <motion.div
                      key={`${cmd.type}-${cmd.timestamp}-${i}`}
                      initial={{ opacity: 0, x: -4 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.02 }}
                      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-zinc-800/30 transition-colors group"
                    >
                      {/* Status dot */}
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: statusColor }}
                      />

                      {/* Type badge */}
                      <span
                        className="text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0"
                        style={{
                          color: typeInfo.color,
                          backgroundColor: `${typeInfo.color}12`,
                        }}
                      >
                        {typeInfo.label}
                      </span>

                      {/* Description */}
                      <span className="text-[11px] text-zinc-400 truncate flex-1">
                        {cmd.description}
                      </span>

                      {/* Timestamp */}
                      <span className="text-[9px] text-zinc-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        {formatTimeAgo(cmd.timestamp)}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
