'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';
import { useControlStore } from '@/lib/store';

const STATUS_COLORS: Record<string, string> = {
  queued: '#F59E0B',
  started: '#3B82F6',
  succeeded: '#10B981',
  failed: '#EF4444',
  cancelled: '#6B7280',
};

const COMMAND_TYPE_COLORS: Record<string, string> = {
  stop_movement: '#EF4444',
  follow_player: '#8B5CF6',
  walk_to_coords: '#3B82F6',
  pause_voyager: '#F59E0B',
  resume_voyager: '#10B981',
  move_to_marker: '#0EA5E9',
  return_to_base: '#14B8A6',
  regroup: '#22C55E',
  guard_zone: '#F97316',
  patrol_route: '#A855F7',
  equip_best: '#EC4899',
  unstuck: '#EAB308',
  default: '#6B7280',
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

function commandTypeLabel(type: string): string {
  return type.replace(/_/g, ' ');
}

interface Props {
  botName: string;
}

export function CommandHistoryPanel({ botName }: Props) {
  const commandHistory = useControlStore((s) => s.commandHistory);
  const [loading, setLoading] = useState(commandHistory.length === 0);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (commandHistory.length > 0) {
      return;
    }

    api.getCommands({ bot: botName, limit: 30 })
      .then((data) => {
        useControlStore.getState().setCommands(data.commands);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [botName, commandHistory.length]);

  const commands = useMemo(
    () => commandHistory.filter((command) => command.targets.some((target) => target.toLowerCase() === botName.toLowerCase())).slice(0, 30),
    [commandHistory, botName],
  );

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
                  const statusColor = STATUS_COLORS[cmd.status] || '#6B7280';
                  const typeColor = COMMAND_TYPE_COLORS[cmd.type] || COMMAND_TYPE_COLORS.default;
                  const description = cmd.error?.message
                    ? cmd.error.message
                    : cmd.result?.message && typeof cmd.result.message === 'string'
                      ? cmd.result.message
                      : cmd.targets.join(', ');

                  return (
                    <motion.div
                      key={`${cmd.id}-${i}`}
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
                            color: typeColor,
                            backgroundColor: `${typeColor}12`,
                          }}
                        >
                          {commandTypeLabel(cmd.type)}
                        </span>

                        {/* Description */}
                        <span className="text-[11px] text-zinc-400 truncate flex-1">
                          {description}
                        </span>

                        {/* Timestamp */}
                        <span className="text-[9px] text-zinc-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          {formatTimeAgo(cmd.createdAt)}
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
