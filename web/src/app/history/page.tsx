'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  api,
  type CommandRecord,
  type MissionRecord,
  type CommanderHistoryEntry,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';

// ---------------------------------------------------------------------------
// Unified timeline entry
// ---------------------------------------------------------------------------

type TimelineKind = 'command' | 'mission' | 'commander';

interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  timestamp: number; // ms epoch for sorting
  botName: string;
  /** Display-friendly summary */
  label: string;
  status: string;
  raw: CommandRecord | MissionRecord | CommanderHistoryEntry;
}

// ---------------------------------------------------------------------------
// Tab types
// ---------------------------------------------------------------------------

type TabKey = 'all' | 'commands' | 'missions' | 'commander';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'commands', label: 'Commands' },
  { key: 'missions', label: 'Missions' },
  { key: 'commander', label: 'Commander' },
];

// ---------------------------------------------------------------------------
// Status badge colours
// ---------------------------------------------------------------------------

const STATUS_COLOR: Record<string, string> = {
  pending: '#F59E0B',
  dispatched: '#A78BFA',
  running: '#3B82F6',
  active: '#3B82F6',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#6B7280',
  timed_out: '#F97316',
  paused: '#F59E0B',
};

const KIND_COLOR: Record<TimelineKind, string> = {
  command: '#60A5FA',
  mission: '#A78BFA',
  commander: '#F59E0B',
};

const KIND_ICON: Record<TimelineKind, string> = {
  command: '>',
  mission: 'M',
  commander: 'NL',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toEpoch(ts: string | number): number {
  if (typeof ts === 'number') return ts;
  const n = Date.parse(ts);
  return Number.isNaN(n) ? 0 : n;
}

function buildEntries(
  commands: CommandRecord[],
  missions: MissionRecord[],
  commander: CommanderHistoryEntry[],
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (const c of commands) {
    entries.push({
      id: c.id,
      kind: 'command',
      timestamp: toEpoch(c.createdAt),
      botName: c.botName,
      label: `${c.type} command`,
      status: c.status,
      raw: c,
    });
  }

  for (const m of missions) {
    entries.push({
      id: m.id,
      kind: 'mission',
      timestamp: toEpoch(m.createdAt),
      botName: m.botName,
      label: m.description || `${m.type} mission`,
      status: m.status,
      raw: m,
    });
  }

  for (const e of commander) {
    entries.push({
      id: e.id,
      kind: 'commander',
      timestamp: toEpoch(e.createdAt),
      botName: e.botName || 'fleet',
      label: e.nlInput,
      status: 'parsed',
      raw: e,
    });
  }

  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLOR[status] ?? '#6B7280';
  return (
    <span
      className="text-[10px] px-2 py-0.5 rounded font-medium shrink-0"
      style={{ color, backgroundColor: `${color}15` }}
    >
      {status}
    </span>
  );
}

function LinkedIds({
  ids,
  kind,
  onSelect,
}: {
  ids: string[];
  kind: 'command' | 'mission';
  onSelect: (id: string) => void;
}) {
  if (!ids.length) return null;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <span className="text-[10px] text-zinc-600 mr-0.5">{kind}s:</span>
      {ids.map((id) => (
        <button
          key={id}
          onClick={() => onSelect(id)}
          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-cyan-400 hover:bg-zinc-700 hover:text-cyan-300 transition-colors cursor-pointer"
          title={`View ${kind} ${id}`}
        >
          {id.slice(0, 8)}
        </button>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function DetailPanel({
  entry,
  onClose,
  onSelectId,
}: {
  entry: TimelineEntry;
  onClose: () => void;
  onSelectId: (id: string) => void;
}) {
  const raw = entry.raw;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-5 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold"
            style={{
              color: KIND_COLOR[entry.kind],
              backgroundColor: `${KIND_COLOR[entry.kind]}15`,
            }}
          >
            {KIND_ICON[entry.kind]}
          </span>
          <span className="text-sm font-semibold text-white">{entry.label}</span>
          <StatusBadge status={entry.status} />
        </div>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors"
        >
          Close
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <div>
          <span className="text-zinc-500">ID</span>
          <p className="text-zinc-300 font-mono">{entry.id}</p>
        </div>
        <div>
          <span className="text-zinc-500">Bot</span>
          <p className="text-zinc-300">{entry.botName}</p>
        </div>
        <div>
          <span className="text-zinc-500">Created</span>
          <p className="text-zinc-300">{new Date(entry.timestamp).toLocaleString()}</p>
        </div>
        <div>
          <span className="text-zinc-500">Kind</span>
          <p className="text-zinc-300 capitalize">{entry.kind}</p>
        </div>
      </div>

      {/* Command-specific fields */}
      {entry.kind === 'command' && (
        <div className="space-y-2 text-xs">
          {(raw as CommandRecord).error && (
            <div>
              <span className="text-zinc-500">Error</span>
              <p className="text-red-400">{(raw as CommandRecord).error}</p>
            </div>
          )}
          {(raw as CommandRecord).linkedMissionId && (
            <div>
              <span className="text-zinc-500">Linked Mission</span>
              <div className="mt-0.5">
                <LinkedIds
                  ids={[(raw as CommandRecord).linkedMissionId!]}
                  kind="mission"
                  onSelect={onSelectId}
                />
              </div>
            </div>
          )}
          {Object.keys((raw as CommandRecord).params || {}).length > 0 && (
            <div>
              <span className="text-zinc-500">Params</span>
              <pre className="text-zinc-400 bg-zinc-800/60 rounded p-2 mt-1 overflow-x-auto text-[11px]">
                {JSON.stringify((raw as CommandRecord).params, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Mission-specific fields */}
      {entry.kind === 'mission' && (
        <div className="space-y-2 text-xs">
          {(raw as MissionRecord).blockedReason && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
              <span className="text-amber-400 font-medium">Blocked: </span>
              <span className="text-amber-300">{(raw as MissionRecord).blockedReason}</span>
            </div>
          )}
          {(raw as MissionRecord).error && (
            <div>
              <span className="text-zinc-500">Error</span>
              <p className="text-red-400">{(raw as MissionRecord).error}</p>
            </div>
          )}
          {(raw as MissionRecord).linkedCommandIds &&
            (raw as MissionRecord).linkedCommandIds!.length > 0 && (
              <div>
                <span className="text-zinc-500">Linked Commands</span>
                <div className="mt-0.5">
                  <LinkedIds
                    ids={(raw as MissionRecord).linkedCommandIds!}
                    kind="command"
                    onSelect={onSelectId}
                  />
                </div>
              </div>
            )}
          {(raw as MissionRecord).dependencies &&
            (raw as MissionRecord).dependencies!.length > 0 && (
              <div>
                <span className="text-zinc-500">Dependencies</span>
                <div className="mt-0.5">
                  <LinkedIds
                    ids={(raw as MissionRecord).dependencies!}
                    kind="mission"
                    onSelect={onSelectId}
                  />
                </div>
              </div>
            )}
        </div>
      )}

      {/* Commander-specific fields */}
      {entry.kind === 'commander' && (
        <div className="space-y-2 text-xs">
          <div>
            <span className="text-zinc-500">Natural Language Input</span>
            <p className="text-zinc-300 italic">"{(raw as CommanderHistoryEntry).nlInput}"</p>
          </div>
          <div>
            <span className="text-zinc-500">Parsed Intent</span>
            <p className="text-zinc-300">{(raw as CommanderHistoryEntry).parsedIntent}</p>
          </div>
          {(raw as CommanderHistoryEntry).resultingCommandIds.length > 0 && (
            <div>
              <span className="text-zinc-500">Resulting Commands</span>
              <div className="mt-0.5">
                <LinkedIds
                  ids={(raw as CommanderHistoryEntry).resultingCommandIds}
                  kind="command"
                  onSelect={onSelectId}
                />
              </div>
            </div>
          )}
          {(raw as CommanderHistoryEntry).resultingMissionIds.length > 0 && (
            <div>
              <span className="text-zinc-500">Resulting Missions</span>
              <div className="mt-0.5">
                <LinkedIds
                  ids={(raw as CommanderHistoryEntry).resultingMissionIds}
                  kind="mission"
                  onSelect={onSelectId}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function HistoryPage() {
  const [commands, setCommands] = useState<CommandRecord[]>([]);
  const [missions, setMissions] = useState<MissionRecord[]>([]);
  const [commander, setCommander] = useState<CommanderHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<TabKey>('all');
  const [botFilter, setBotFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // ── Fetch data ──────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    try {
      const [cmdRes, misRes, cdrRes] = await Promise.allSettled([
        api.getCommands(),
        api.getMissions(),
        api.getCommanderHistory(),
      ]);

      if (cmdRes.status === 'fulfilled') setCommands(cmdRes.value.commands);
      else setCommands([]);

      if (misRes.status === 'fulfilled') setMissions(misRes.value.missions);
      else setMissions([]);

      if (cdrRes.status === 'fulfilled') setCommander(cdrRes.value.entries);
      else setCommander([]);

      setError(null);
    } catch (err: any) {
      setError(err.message ?? 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    if (autoRefresh) {
      const interval = setInterval(fetchAll, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, fetchAll]);

  // ── Derived state ───────────────────────────────────────────────────────
  const allEntries = useMemo(
    () => buildEntries(commands, missions, commander),
    [commands, missions, commander],
  );

  const botNames = useMemo(() => {
    const set = new Set<string>();
    for (const e of allEntries) set.add(e.botName);
    return Array.from(set).sort();
  }, [allEntries]);

  const filtered = useMemo(() => {
    return allEntries.filter((e) => {
      if (tab !== 'all' && tab !== `${e.kind}s` && tab !== e.kind) {
        // tab key: 'commands' -> kind 'command', 'missions' -> kind 'mission'
        const kindFromTab = tab.replace(/s$/, '') as TimelineKind;
        if (e.kind !== kindFromTab) return false;
      }
      if (botFilter !== 'all' && e.botName !== botFilter) return false;
      if (
        search &&
        !e.label.toLowerCase().includes(search.toLowerCase()) &&
        !e.id.toLowerCase().includes(search.toLowerCase()) &&
        !e.botName.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      return true;
    });
  }, [allEntries, tab, botFilter, search]);

  const selectedEntry = useMemo(
    () => (selectedId ? allEntries.find((e) => e.id === selectedId) ?? null : null),
    [selectedId, allEntries],
  );

  // When clicking a linked ID, highlight it and switch to All tab
  const handleSelectId = useCallback(
    (id: string) => {
      setSelectedId(id);
      setTab('all');
      setBotFilter('all');
      setSearch('');
    },
    [],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  const totalLabel = `${filtered.length} record${filtered.length !== 1 ? 's' : ''}${
    botFilter !== 'all' || search || tab !== 'all' ? ' (filtered)' : ''
  }`;

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-5xl">
      <PageHeader title="History" subtitle={totalLabel}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              autoRefresh
                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'
              }`}
            />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
        </div>
      </PageHeader>

      {/* Tabs + Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Tabs */}
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                tab === t.key
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Bot filter dropdown */}
        <select
          value={botFilter}
          onChange={(e) => setBotFilter(e.target.value)}
          className="bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white appearance-none cursor-pointer"
        >
          <option value="all">All bots</option>
          {botNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history..."
            className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500"
          />
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {/* Detail panel */}
      {selectedEntry && (
        <DetailPanel
          entry={selectedEntry}
          onClose={() => setSelectedId(null)}
          onSelectId={handleSelectId}
        />
      )}

      {/* Timeline */}
      <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <p className="text-sm text-zinc-500">Loading history...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-zinc-500">
              No history{botFilter !== 'all' || search || tab !== 'all' ? ' matching filters' : ' yet'}
            </p>
            {(botFilter !== 'all' || search || tab !== 'all') && (
              <button
                onClick={() => {
                  setBotFilter('all');
                  setSearch('');
                  setTab('all');
                }}
                className="text-xs text-zinc-500 hover:text-zinc-300 mt-2 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {filtered.map((entry, i) => {
              const kindColor = KIND_COLOR[entry.kind];
              const time = new Date(entry.timestamp);
              const isSelected = selectedId === entry.id;
              const mission = entry.kind === 'mission' ? (entry.raw as MissionRecord) : null;

              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.015, 0.4) }}
                  onClick={() => setSelectedId(isSelected ? null : entry.id)}
                  className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                    isSelected ? 'bg-zinc-800/50' : 'hover:bg-zinc-800/20'
                  }`}
                >
                  {/* Timestamp */}
                  <span className="text-[11px] text-zinc-600 font-mono shrink-0 w-32 tabular-nums pt-0.5">
                    {time.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                    {time.toLocaleTimeString()}
                  </span>

                  {/* Kind icon */}
                  <span
                    className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={{ color: kindColor, backgroundColor: `${kindColor}12` }}
                  >
                    {KIND_ICON[entry.kind]}
                  </span>

                  {/* Bot name */}
                  <span className="text-xs text-zinc-300 font-medium shrink-0 w-28 truncate pt-0.5">
                    {entry.botName}
                  </span>

                  {/* Label + inline details */}
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <span className="text-xs text-zinc-400 block truncate">{entry.label}</span>

                    {/* Blocked reason - prominent */}
                    {mission?.blockedReason && (
                      <span className="text-[10px] text-amber-400 block truncate">
                        Blocked: {mission.blockedReason}
                      </span>
                    )}

                    {/* Linked command IDs - clickable */}
                    {mission?.linkedCommandIds && mission.linkedCommandIds.length > 0 && (
                      <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
                        <LinkedIds
                          ids={mission.linkedCommandIds}
                          kind="command"
                          onSelect={handleSelectId}
                        />
                      </div>
                    )}

                    {/* Commander parsed intent inline */}
                    {entry.kind === 'commander' && (
                      <span className="text-[10px] text-zinc-600 block truncate">
                        Intent: {(entry.raw as CommanderHistoryEntry).parsedIntent}
                      </span>
                    )}
                  </div>

                  {/* Status badge */}
                  <StatusBadge status={entry.status} />

                  {/* Kind label */}
                  <span
                    className="text-[10px] px-2 py-0.5 rounded font-medium shrink-0"
                    style={{ color: kindColor, backgroundColor: `${kindColor}10` }}
                  >
                    {entry.kind}
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
