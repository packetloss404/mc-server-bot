'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { api, type CommandRecord, type MissionRecord } from '@/lib/api';
import { useFleetStore } from '@/lib/store';

type Tab = 'commands' | 'missions';
type StatusFilter = 'all' | 'succeeded' | 'failed' | 'started' | 'queued' | 'cancelled';

const STATUS_COLORS: Record<string, string> = {
  queued: '#F59E0B',
  started: '#3B82F6',
  succeeded: '#10B981',
  failed: '#EF4444',
  cancelled: '#6B7280',
  running: '#3B82F6',
  completed: '#10B981',
  paused: '#A1A1AA',
};

const TYPE_COLORS: Record<string, string> = {
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
  queue_task: '#8B5CF6',
  build_schematic: '#3B82F6',
  gather_items: '#10B981',
  craft_items: '#EC4899',
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

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function commandTypeLabel(type: string): string {
  return type.replace(/_/g, ' ');
}

function missionStatusFilterValue(status: string): StatusFilter {
  if (status === 'completed') return 'succeeded';
  if (status === 'running') return 'started';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  return 'queued';
}

type HistoryItem = CommandRecord | MissionRecord;

function isCommandRecord(item: HistoryItem): item is CommandRecord {
  return 'targets' in item;
}

export default function HistoryPage() {
  const squads = useFleetStore((s) => s.squads);
  const [tab, setTab] = useState<Tab>('commands');
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [botFilter, setBotFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null);
  const [botNames, setBotNames] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [commandData, missionData, botsData] = await Promise.all([
        api.getCommands({ limit: 100 }),
        api.getMissions({ limit: 100 }),
        api.getBots(),
      ]);
      setCommands(commandData.commands);
      setMissions(missionData.missions);
      setBotNames(botsData.bots.map((bot) => bot.name));
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const commandTypes = Array.from(new Set(commands.map((command) => command.type)));
  const missionTypes = Array.from(new Set(missions.map((mission) => mission.type)));

  const filteredCommands = commands.filter((command) => {
    if (botFilter !== 'all' && !command.targets.some((target) => target.toLowerCase() === botFilter.toLowerCase())) return false;
    if (statusFilter !== 'all' && command.status !== statusFilter) return false;
    if (typeFilter !== 'all' && command.type !== typeFilter) return false;
    return true;
  });

  const filteredMissions = missions.filter((mission) => {
    if (botFilter !== 'all') {
      const matchesBot = mission.assigneeType === 'bot'
        ? mission.assigneeIds.some((id) => id.toLowerCase() === botFilter.toLowerCase())
        : mission.assigneeIds.some((id) => squads.find((squad) => squad.id === id)?.botNames.some((name) => name.toLowerCase() === botFilter.toLowerCase()));
      if (!matchesBot) return false;
    }
    if (statusFilter !== 'all' && missionStatusFilterValue(mission.status) !== statusFilter) return false;
    if (typeFilter !== 'all' && mission.type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-7xl">
      <div className="flex items-center gap-2 text-xs text-zinc-600">
        <Link href="/" className="hover:text-zinc-300 transition-colors">Dashboard</Link>
        <span>/</span>
        <span className="text-zinc-400">History</span>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-bold text-white mb-1">History</h1>
        <p className="text-sm text-zinc-500">Commands and missions across all bots</p>
      </motion.div>

      <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800/60 rounded-lg p-1 w-fit">
        {(['commands', 'missions'] as Tab[]).map((value) => (
          <button
            key={value}
            onClick={() => { setTab(value); setSelectedItem(null); setTypeFilter('all'); }}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all capitalize ${
              tab === value ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {value}
          </button>
        ))}
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-3 flex-wrap">
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
          <option value="cancelled">Cancelled</option>
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg px-3 py-1.5 text-xs text-zinc-300 appearance-none cursor-pointer"
        >
          <option value="all">All Types</option>
          {(tab === 'commands' ? commandTypes : missionTypes).map((type) => (
            <option key={type} value={type}>{commandTypeLabel(type)}</option>
          ))}
        </select>

        <span className="text-[10px] text-zinc-600 ml-auto">
          {tab === 'commands' ? filteredCommands.length : filteredMissions.length} items
        </span>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="divide-y divide-zinc-800/40">
                {(tab === 'commands' ? filteredCommands : filteredMissions).map((item) => {
                  const status = isCommandRecord(item) ? item.status : item.status;
                  const type = item.type;
                  const timestamp = isCommandRecord(item) ? item.createdAt : item.createdAt;
                  const color = TYPE_COLORS[type] || TYPE_COLORS.default;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className="w-full text-left px-5 py-3 hover:bg-zinc-800/20 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[status] || '#6B7280' }} />
                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ color, backgroundColor: `${color}15` }}>
                          {commandTypeLabel(type)}
                        </span>
                        <span className="text-sm text-zinc-200 truncate flex-1">
                          {isCommandRecord(item)
                            ? item.targets.join(', ')
                            : item.title}
                        </span>
                        <span className="text-[11px] text-zinc-500 shrink-0">{formatTimeAgo(timestamp)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </motion.div>
        </div>

        <div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 min-h-[240px]">
            {!selectedItem ? (
              <p className="text-xs text-zinc-600 text-center py-10">Select an item to inspect details</p>
            ) : isCommandRecord(selectedItem) ? (
              <div className="space-y-3 text-xs">
                <DetailRow label="Type" value={selectedItem.type} />
                <DetailRow label="Status" value={selectedItem.status} />
                <DetailRow label="Targets" value={selectedItem.targets.join(', ')} />
                <DetailRow label="Priority" value={selectedItem.priority} />
                <DetailRow label="Source" value={selectedItem.source} />
                <DetailRow label="Created" value={formatTimestamp(selectedItem.createdAt)} />
                {selectedItem.error?.message && <DetailRow label="Error" value={selectedItem.error.message} />}
              </div>
            ) : (
              <div className="space-y-3 text-xs">
                <DetailRow label="Title" value={selectedItem.title} />
                <DetailRow label="Type" value={selectedItem.type} />
                <DetailRow label="Status" value={selectedItem.status} />
                <DetailRow label="Assignees" value={selectedItem.assigneeIds.join(', ')} />
                <DetailRow label="Priority" value={selectedItem.priority} />
                <DetailRow label="Source" value={selectedItem.source} />
                <DetailRow label="Created" value={formatTimestamp(selectedItem.createdAt)} />
                {selectedItem.blockedReason && <DetailRow label="Blocked" value={selectedItem.blockedReason} />}
              </div>
            )}
          </motion.div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">{label}</p>
      <p className="text-zinc-200 break-words">{value}</p>
    </div>
  );
}
