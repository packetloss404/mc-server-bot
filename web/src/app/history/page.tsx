'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { api, type BotEvent } from '@/lib/api';

type Tab = 'commands' | 'missions';
type StatusFilter = 'all' | 'succeeded' | 'failed' | 'started' | 'queued';

const STATUS_COLORS: Record<string, string> = {
  queued: '#F59E0B',
  started: '#3B82F6',
  succeeded: '#10B981',
  failed: '#EF4444',
  cancelled: '#6B7280',
};

const TYPE_COLORS: Record<string, string> = {
  task_started: '#3B82F6',
  task_completed: '#10B981',
  task_failed: '#EF4444',
  skill_executed: '#8B5CF6',
  movement: '#F59E0B',
  chat: '#EC4899',
  action: '#06B6D4',
  state_change: '#6B7280',
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

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getEventStatus(type: string): string {
  if (type.includes('completed') || type.includes('succeeded')) return 'succeeded';
  if (type.includes('failed')) return 'failed';
  if (type.includes('started') || type.includes('running')) return 'started';
  if (type.includes('cancelled')) return 'cancelled';
  return 'queued';
}

interface MissionRecord {
  id: string;
  botName: string;
  title: string;
  type: string;
  status: string;
  createdAt: number;
}

export default function HistoryPage() {
  const [tab, setTab] = useState<Tab>('commands');
  const [events, setEvents] = useState<BotEvent[]>([]);
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [botFilter, setBotFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState<BotEvent | MissionRecord | null>(null);
  const [botNames, setBotNames] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [activityData, botsData] = await Promise.all([
        api.getActivity(100),
        api.getBots(),
      ]);
      setEvents(activityData.events);
      const names = botsData.bots.map((b) => b.name);
      setBotNames(names);

      // Build mission records from per-bot task data
      const allMissions: MissionRecord[] = [];
      await Promise.all(
        names.map(async (name) => {
          try {
            const tasks = await api.getBotTasks(name);
            if (tasks.currentTask) {
              allMissions.push({
                id: `${name}-current`,
                botName: name,
                title: tasks.currentTask,
                type: 'task',
                status: 'running',
                createdAt: Date.now(),
              });
            }
            tasks.completedTasks.forEach((t, i) => {
              allMissions.push({
                id: `${name}-completed-${i}`,
                botName: name,
                title: t,
                type: 'task',
                status: 'completed',
                createdAt: Date.now() - (tasks.completedTasks.length - i) * 60000,
              });
            });
            tasks.failedTasks.forEach((t, i) => {
              allMissions.push({
                id: `${name}-failed-${i}`,
                botName: name,
                title: t,
                type: 'task',
                status: 'failed',
                createdAt: Date.now() - (tasks.failedTasks.length - i) * 120000,
              });
            });
          } catch {
            // bot may not have task data
          }
        })
      );
      setMissions(allMissions.sort((a, b) => b.createdAt - a.createdAt));
    } catch {
      // ignore
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Get unique event types for filter
  const eventTypes = Array.from(new Set(events.map((e) => e.type)));

  // Filter events
  const filteredEvents = events.filter((e) => {
    if (botFilter !== 'all' && e.botName.toLowerCase() !== botFilter.toLowerCase()) return false;
    if (statusFilter !== 'all' && getEventStatus(e.type) !== statusFilter) return false;
    if (typeFilter !== 'all' && e.type !== typeFilter) return false;
    return true;
  });

  // Filter missions
  const filteredMissions = missions.filter((m) => {
    if (botFilter !== 'all' && m.botName.toLowerCase() !== botFilter.toLowerCase()) return false;
    if (statusFilter !== 'all') {
      const s = m.status === 'completed' ? 'succeeded' : m.status === 'running' ? 'started' : m.status;
      if (s !== statusFilter) return false;
    }
    return true;
  });

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-zinc-600">
        <Link href="/" className="hover:text-zinc-300 transition-colors">Dashboard</Link>
        <span>/</span>
        <span className="text-zinc-400">History</span>
      </div>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-white mb-1">History</h1>
        <p className="text-sm text-zinc-500">Commands and missions across all bots</p>
      </motion.div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800/60 rounded-lg p-1 w-fit">
        {(['commands', 'missions'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setSelectedItem(null); }}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
              tab === t
                ? 'bg-zinc-800 text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Filters */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center gap-3 flex-wrap"
      >
        {/* Bot filter */}
        <select
          value={botFilter}
          onChange={(e) => setBotFilter(e.target.value)}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg px-3 py-1.5 text-xs text-zinc-300 appearance-none cursor-pointer"
        >
          <option value="all">All Bots</option>
          {botNames.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg px-3 py-1.5 text-xs text-zinc-300 appearance-none cursor-pointer"
        >
          <option value="all">All Status</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="started">Started</option>
          <option value="queued">Queued</option>
        </select>

        {/* Type filter (commands tab only) */}
        {tab === 'commands' && (
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg px-3 py-1.5 text-xs text-zinc-300 appearance-none cursor-pointer"
          >
            <option value="all">All Types</option>
            {eventTypes.map((type) => (
              <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
            ))}
          </select>
        )}

        <span className="text-[10px] text-zinc-600 ml-auto">
          {tab === 'commands' ? filteredEvents.length : filteredMissions.length} items
        </span>
      </motion.div>

      {/* Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* List */}
        <div className="lg:col-span-2">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
          >
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
              </div>
            ) : tab === 'commands' ? (
              <CommandsList
                events={filteredEvents}
                selected={selectedItem}
                onSelect={setSelectedItem}
              />
            ) : (
              <MissionsList
                missions={filteredMissions}
                selected={selectedItem}
                onSelect={setSelectedItem}
              />
            )}
          </motion.div>
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-1">
          <AnimatePresence mode="wait">
            {selectedItem ? (
              <motion.div
                key={`detail-${'type' in selectedItem && 'timestamp' in selectedItem ? (selectedItem as BotEvent).timestamp : (selectedItem as MissionRecord).id}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 sticky top-6"
              >
                <DetailPanel item={selectedItem} tab={tab} />
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-6 text-center"
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-zinc-700 mx-auto mb-2"
                >
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <p className="text-xs text-zinc-600">Select an item to see details</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function CommandsList({
  events,
  selected,
  onSelect,
}: {
  events: BotEvent[];
  selected: BotEvent | MissionRecord | null;
  onSelect: (e: BotEvent) => void;
}) {
  if (events.length === 0) {
    return <p className="text-xs text-zinc-600 text-center py-8">No commands found</p>;
  }

  return (
    <div className="divide-y divide-zinc-800/40">
      {events.map((event, i) => {
        const status = getEventStatus(event.type);
        const statusColor = STATUS_COLORS[status] || '#6B7280';
        const typeColor = TYPE_COLORS[event.type] || '#6B7280';
        const isSelected = selected && 'timestamp' in selected && (selected as BotEvent).timestamp === event.timestamp && (selected as BotEvent).type === event.type;

        return (
          <button
            key={`${event.type}-${event.timestamp}-${i}`}
            onClick={() => onSelect(event)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
              isSelected ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'
            }`}
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: statusColor }}
            />
            <span
              className="text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0 uppercase"
              style={{ color: typeColor, backgroundColor: `${typeColor}12` }}
            >
              {event.type.replace(/_/g, ' ')}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-zinc-300 truncate">{event.description}</p>
              <p className="text-[9px] text-zinc-600">{event.botName}</p>
            </div>
            <span className="text-[9px] text-zinc-600 shrink-0">{formatTimeAgo(event.timestamp)}</span>
          </button>
        );
      })}
    </div>
  );
}

function MissionsList({
  missions,
  selected,
  onSelect,
}: {
  missions: MissionRecord[];
  selected: BotEvent | MissionRecord | null;
  onSelect: (m: MissionRecord) => void;
}) {
  if (missions.length === 0) {
    return <p className="text-xs text-zinc-600 text-center py-8">No missions found</p>;
  }

  const missionStatusColor: Record<string, string> = {
    running: '#3B82F6',
    completed: '#10B981',
    failed: '#EF4444',
    queued: '#F59E0B',
  };

  return (
    <div className="divide-y divide-zinc-800/40">
      {missions.map((mission, i) => {
        const statusColor = missionStatusColor[mission.status] || '#6B7280';
        const isSelected = selected && 'id' in selected && (selected as MissionRecord).id === mission.id;

        return (
          <button
            key={`${mission.id}-${i}`}
            onClick={() => onSelect(mission)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
              isSelected ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'
            }`}
          >
            {mission.status === 'running' ? (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: statusColor }} />
                <span className="relative inline-flex rounded-full h-2 w-2" style={{ backgroundColor: statusColor }} />
              </span>
            ) : (
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
            )}
            <span
              className="text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0 capitalize"
              style={{ color: statusColor, backgroundColor: `${statusColor}12` }}
            >
              {mission.status}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-zinc-300 truncate">{mission.title}</p>
              <p className="text-[9px] text-zinc-600">{mission.botName}</p>
            </div>
            <span className="text-[9px] text-zinc-600 shrink-0">{formatTimeAgo(mission.createdAt)}</span>
          </button>
        );
      })}
    </div>
  );
}

function DetailPanel({ item, tab }: { item: BotEvent | MissionRecord; tab: Tab }) {
  if (tab === 'commands' && 'timestamp' in item && 'type' in item) {
    const event = item as BotEvent;
    const status = getEventStatus(event.type);
    const statusColor = STATUS_COLORS[status] || '#6B7280';

    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Command Details</h3>
        <div className="space-y-2.5">
          <DetailRow label="Type" value={event.type.replace(/_/g, ' ')} />
          <DetailRow label="Bot" value={event.botName} />
          <DetailRow label="Status">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
              <span className="text-[11px] capitalize" style={{ color: statusColor }}>{status}</span>
            </span>
          </DetailRow>
          <DetailRow label="Time" value={formatTimestamp(event.timestamp)} />
          <div className="pt-2 border-t border-zinc-800/40">
            <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Description</p>
            <p className="text-xs text-zinc-300">{event.description}</p>
          </div>
          {event.metadata && Object.keys(event.metadata).length > 0 && (
            <div className="pt-2 border-t border-zinc-800/40">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">Metadata</p>
              <pre className="text-[10px] text-zinc-400 bg-zinc-800/50 rounded-lg p-2 overflow-x-auto">
                {JSON.stringify(event.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  if ('id' in item) {
    const mission = item as MissionRecord;
    const missionStatusColor: Record<string, string> = {
      running: '#3B82F6',
      completed: '#10B981',
      failed: '#EF4444',
      queued: '#F59E0B',
    };
    const statusColor = missionStatusColor[mission.status] || '#6B7280';

    return (
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Mission Details</h3>
        <div className="space-y-2.5">
          <DetailRow label="Title" value={mission.title} />
          <DetailRow label="Bot">
            <Link href={`/bots/${mission.botName}`} className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors">
              {mission.botName}
            </Link>
          </DetailRow>
          <DetailRow label="Type" value={mission.type} />
          <DetailRow label="Status">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
              <span className="text-[11px] capitalize" style={{ color: statusColor }}>{mission.status}</span>
            </span>
          </DetailRow>
          <DetailRow label="Created" value={formatTimestamp(mission.createdAt)} />
        </div>
      </div>
    );
  }

  return null;
}

function DetailRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] text-zinc-600 uppercase tracking-wider shrink-0">{label}</span>
      {children || <span className="text-[11px] text-zinc-300 text-right truncate">{value}</span>}
    </div>
  );
}
