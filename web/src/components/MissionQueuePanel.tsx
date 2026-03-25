'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, type MissionRecord } from '@/lib/api';
import { useMissionStore } from '@/lib/store';

const STATUS_COLORS: Record<string, string> = {
  running: '#3B82F6',
  queued: '#F59E0B',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#6B7280',
  paused: '#A1A1AA',
  draft: '#6B7280',
};

const TYPE_COLORS: Record<string, string> = {
  queue_task: '#8B5CF6',
  build_schematic: '#3B82F6',
  gather_items: '#10B981',
  patrol_zone: '#F59E0B',
  craft_items: '#EC4899',
  supply_chain: '#06B6D4',
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
  const missionStore = useMissionStore((s) => s.missions);
  const upsertMission = useMissionStore((s) => s.upsertMission);
  const [queueMissionIds, setQueueMissionIds] = useState<string[]>([]);
  const [fetchedMissionIds, setFetchedMissionIds] = useState<string[]>([]);
  const [queueMissionMap, setQueueMissionMap] = useState<Record<string, MissionRecord>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchMissions = useCallback(async () => {
    setLoading(true);
    try {
      const [queueData, missionData] = await Promise.all([
        api.getBotMissionQueue(botName),
        api.getMissions({ bot: botName, limit: 50 }),
      ]);
      setQueueMissionIds(queueData.missions.map((mission) => mission.id));
      setQueueMissionMap(Object.fromEntries(queueData.missions.map((mission) => [mission.id, mission])));
      setFetchedMissionIds(missionData.missions.map((mission) => mission.id));
      missionData.missions.forEach((mission) => upsertMission(mission));
    } catch {
      setQueueMissionIds([]);
      setFetchedMissionIds([]);
      setQueueMissionMap({});
    } finally {
      setLoading(false);
    }
  }, [botName, upsertMission]);

  useEffect(() => {
    void fetchMissions();
  }, [fetchMissions]);

  const botMissions = missionStore.filter((mission) => fetchedMissionIds.includes(mission.id));

  const runningMission = botMissions.find((mission) => mission.status === 'running');
  const queuedMissions = queueMissionIds
    .map((id) => queueMissionMap[id] ?? botMissions.find((mission) => mission.id === id))
    .filter((mission): mission is MissionRecord => Boolean(mission))
    .filter((mission) => mission.status === 'queued');
  const recentMissions = botMissions.filter((mission) =>
    mission.status === 'completed' || mission.status === 'failed' || mission.status === 'cancelled',
  );

  const handleCancelMission = useCallback(async (missionId: string) => {
    setActionLoading(`cancel-${missionId}`);
    try {
      const result = await api.cancelMission(missionId);
      upsertMission(result.mission);
      await fetchMissions();
    } finally {
      setActionLoading(null);
    }
  }, [fetchMissions, upsertMission]);

  const handleRetryMission = useCallback(async (missionId: string) => {
    setActionLoading(`retry-${missionId}`);
    try {
      const result = await api.retryMission(missionId);
      upsertMission(result.mission);
      await fetchMissions();
    } finally {
      setActionLoading(null);
    }
  }, [fetchMissions, upsertMission]);

  const handleReorderMission = useCallback(async (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= queueMissionIds.length) return;
    setActionLoading(`reorder-${fromIndex}-${toIndex}`);
    try {
      await api.updateBotMissionQueue(botName, { action: 'reorder', fromIndex, toIndex });
      await fetchMissions();
    } finally {
      setActionLoading(null);
    }
  }, [botName, fetchMissions, queueMissionIds.length]);

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
      ) : botMissions.length === 0 ? (
        <p className="text-xs text-zinc-600 text-center py-4">No missions in queue</p>
      ) : (
        <div className="space-y-2">
          {runningMission && (
            <MissionItem
              mission={runningMission}
              isActive
              loading={actionLoading}
              onCancel={() => handleCancelMission(runningMission.id)}
            />
          )}

          <AnimatePresence>
            {queuedMissions.map((mission, index) => (
              <MissionItem
                key={mission.id}
                mission={mission}
                index={index}
                queueLength={queuedMissions.length}
                showReorder={queuedMissions.length > 1}
                loading={actionLoading}
                onMoveUp={() => handleReorderMission(index, index - 1)}
                onMoveDown={() => handleReorderMission(index, index + 1)}
                onCancel={() => handleCancelMission(mission.id)}
              />
            ))}
          </AnimatePresence>

          {recentMissions.length > 0 && (
            <div className="pt-2 border-t border-zinc-800/40">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1.5">Recent</p>
              {recentMissions.slice(0, 5).map((mission) => (
                <MissionItem
                  key={mission.id}
                  mission={mission}
                  compact
                  loading={actionLoading}
                  onRetry={() => handleRetryMission(mission.id)}
                />
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
  queueLength,
  loading,
  onMoveUp,
  onMoveDown,
  onRetry,
  onCancel,
}: {
  mission: MissionRecord;
  isActive?: boolean;
  compact?: boolean;
  index?: number;
  showReorder?: boolean;
  queueLength?: number;
  loading?: string | null;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  const statusColor = STATUS_COLORS[mission.status] || '#6B7280';
  const typeColor = TYPE_COLORS[mission.type] || TYPE_COLORS.default;

  if (compact) {
    return (
      <div className="flex items-center gap-2 py-1 px-1 rounded hover:bg-zinc-800/30 transition-colors">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
        <span className="text-[11px] text-zinc-500 truncate flex-1">{mission.title}</span>
        {mission.status === 'failed' && onRetry && (
          <ActionBtn title="Retry" color="#F59E0B" disabled={loading !== null} onClick={onRetry}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 4v6h6" /><path d="M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
          </ActionBtn>
        )}
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
        <div className="mt-1 shrink-0">
          {isActive ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: statusColor }} />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: statusColor }} />
            </span>
          ) : (
            <span className="block w-2 h-2 rounded-full" style={{ backgroundColor: statusColor }} />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs text-zinc-300 font-medium truncate">{mission.title}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded uppercase" style={{ color: typeColor, backgroundColor: `${typeColor}15` }}>
              {mission.type}
            </span>
            <span className="text-[9px] text-amber-500/70 uppercase">{mission.priority}</span>
            <span className="text-[9px] text-zinc-600">{formatTimeAgo(mission.createdAt)}</span>
          </div>
          {mission.blockedReason && (
            <p className="text-[10px] text-amber-400/80 mt-1 truncate">{mission.blockedReason}</p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {showReorder && typeof index === 'number' && (
            <>
              <ActionBtn title="Move up" disabled={index === 0 || !onMoveUp || loading !== null} onClick={onMoveUp}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 15l-6-6-6 6" /></svg>
              </ActionBtn>
              <ActionBtn title="Move down" disabled={index === (queueLength ?? 1) - 1 || !onMoveDown || loading !== null} onClick={onMoveDown}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
              </ActionBtn>
            </>
          )}
          {mission.status === 'failed' && onRetry && (
            <ActionBtn title="Retry" color="#F59E0B" disabled={loading !== null} onClick={onRetry}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M1 4v6h6" /><path d="M23 20v-6h-6" /><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" /></svg>
            </ActionBtn>
          )}
          {(mission.status === 'running' || mission.status === 'queued') && onCancel && (
            <ActionBtn title="Cancel" color="#EF4444" disabled={loading !== null} onClick={onCancel}>
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
