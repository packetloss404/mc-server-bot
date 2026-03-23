'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '@/lib/api';

interface Mission {
  id: string;
  title: string;
  type: string;
  priority: number;
  status: 'running' | 'queued' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
}

const STATUS_COLORS: Record<string, string> = {
  running: '#3B82F6',
  queued: '#F59E0B',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#6B7280',
};

const TYPE_COLORS: Record<string, string> = {
  task: '#8B5CF6',
  build: '#3B82F6',
  gather: '#10B981',
  explore: '#F59E0B',
  combat: '#EF4444',
  craft: '#EC4899',
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

interface Props {
  botName: string;
}

export function MissionQueuePanel({ botName }: Props) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMissions = useCallback(async () => {
    try {
      // Try the mission queue endpoint; fall back to constructing from voyager task data
      const data = await api.getBotMissionQueue(botName);
      setMissions(data.missions as unknown as Mission[]);
    } catch {
      // Fallback: build mission list from voyager task info
      try {
        const taskData = await api.getBotTasks(botName);
        const built: Mission[] = [];
        if (taskData.currentTask) {
          built.push({
            id: 'current',
            title: taskData.currentTask,
            type: 'task',
            priority: 1,
            status: 'running',
            createdAt: Date.now(),
          });
        }
        taskData.completedTasks.slice(-5).reverse().forEach((t, i) => {
          built.push({
            id: `completed-${i}`,
            title: t,
            type: 'task',
            priority: 0,
            status: 'completed',
            createdAt: Date.now() - (i + 1) * 60000,
          });
        });
        taskData.failedTasks.slice(-3).reverse().forEach((t, i) => {
          built.push({
            id: `failed-${i}`,
            title: t,
            type: 'task',
            priority: 0,
            status: 'failed',
            createdAt: Date.now() - (i + 1) * 120000,
          });
        });
        setMissions(built);
      } catch {
        setMissions([]);
      }
    }
    setLoading(false);
  }, [botName]);

  useEffect(() => {
    fetchMissions();
    const interval = setInterval(fetchMissions, 5000);
    return () => clearInterval(interval);
  }, [fetchMissions]);

  const runningMission = missions.find((m) => m.status === 'running');
  const queuedMissions = missions.filter((m) => m.status === 'queued');
  const recentMissions = missions.filter((m) => m.status === 'completed' || m.status === 'failed' || m.status === 'cancelled');

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Mission Queue</h2>
        <button
          className="text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1 rounded border border-zinc-800/60 hover:border-zinc-700/60"
          title="Add Mission (coming soon)"
          disabled
        >
          + Add Mission
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
        </div>
      ) : missions.length === 0 ? (
        <p className="text-xs text-zinc-600 text-center py-4">No missions in queue</p>
      ) : (
        <div className="space-y-2">
          {/* Running Mission */}
          {runningMission && (
            <MissionItem mission={runningMission} isActive />
          )}

          {/* Queued Missions */}
          <AnimatePresence>
            {queuedMissions.map((mission, index) => (
              <MissionItem key={mission.id} mission={mission} index={index} showReorder={queuedMissions.length > 1} />
            ))}
          </AnimatePresence>

          {/* Recent completed/failed */}
          {recentMissions.length > 0 && (
            <div className="pt-2 border-t border-zinc-800/40">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">Recent</p>
              {recentMissions.slice(0, 5).map((mission) => (
                <MissionItem key={mission.id} mission={mission} compact />
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function MissionItem({
  mission,
  isActive,
  compact,
  index,
  showReorder,
}: {
  mission: Mission;
  isActive?: boolean;
  compact?: boolean;
  index?: number;
  showReorder?: boolean;
}) {
  const statusColor = STATUS_COLORS[mission.status] || '#6B7280';
  const typeColor = TYPE_COLORS[mission.type] || TYPE_COLORS.default;

  if (compact) {
    return (
      <div className="flex items-center gap-2 py-1 px-1 rounded hover:bg-zinc-800/30 transition-colors">
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: statusColor }}
        />
        <span className="text-[11px] text-zinc-500 truncate flex-1">{mission.title}</span>
        <span className="text-[9px] text-zinc-600 shrink-0">{formatTimeAgo(mission.createdAt)}</span>
      </div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      className={`rounded-lg p-2.5 border transition-colors ${
        isActive
          ? 'bg-blue-500/5 border-blue-500/20'
          : 'bg-zinc-800/30 border-zinc-800/40 hover:border-zinc-700/40'
      }`}
    >
      <div className="flex items-start gap-2">
        {/* Status indicator */}
        <div className="mt-1 shrink-0">
          {isActive ? (
            <span className="relative flex h-2.5 w-2.5">
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ backgroundColor: statusColor }}
              />
              <span
                className="relative inline-flex rounded-full h-2.5 w-2.5"
                style={{ backgroundColor: statusColor }}
              />
            </span>
          ) : (
            <span
              className="block w-2 h-2 rounded-full"
              style={{ backgroundColor: statusColor }}
            />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs text-zinc-300 font-medium truncate">{mission.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="text-[9px] font-medium px-1.5 py-0.5 rounded uppercase"
              style={{ color: typeColor, backgroundColor: `${typeColor}15` }}
            >
              {mission.type}
            </span>
            {mission.priority > 0 && (
              <span className="text-[9px] text-amber-500/70">P{mission.priority}</span>
            )}
            <span className="text-[9px] text-zinc-600">{formatTimeAgo(mission.createdAt)}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {showReorder && typeof index === 'number' && (
            <>
              <ActionBtn title="Move up" disabled={index === 0}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6" /></svg>
              </ActionBtn>
              <ActionBtn title="Move down">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
              </ActionBtn>
            </>
          )}
          {mission.status === 'failed' && (
            <ActionBtn title="Retry" color="#F59E0B">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 4v6h6" /><path d="M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
            </ActionBtn>
          )}
          {(mission.status === 'running' || mission.status === 'queued') && (
            <ActionBtn title="Cancel" color="#EF4444">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </ActionBtn>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function ActionBtn({
  children,
  title,
  color,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  color?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="p-1 rounded hover:bg-zinc-700/50 disabled:opacity-30 transition-colors"
      style={{ color: color || '#a1a1aa' }}
    >
      {children}
    </button>
  );
}
