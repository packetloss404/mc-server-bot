'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useBotStore, type BotLiveData } from '@/lib/store';
import { api } from '@/lib/api';
import { getPersonalityColor, STATE_COLORS, STATE_LABELS, PERSONALITY_ICONS } from '@/lib/constants';
import { PageHeader } from '@/components/PageHeader';
import { FleetSelectionBar } from '@/components/FleetSelectionBar';

// ---- Types ----

interface Squad {
  id: string;
  name: string;
  botNames: string[];
  createdAt: number;
}

interface BatchResult {
  total: number;
  succeeded: number;
  failed: number;
  errors: { botName: string; error: string }[];
}

// ---- Persistence helpers ----

function loadSquads(): Squad[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('dyocraft-squads');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSquads(squads: Squad[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('dyocraft-squads', JSON.stringify(squads));
}

// ---- Main page ----

export default function FleetPage() {
  const bots = useBotStore((s) => s.botList);
  const [selectedBots, setSelectedBots] = useState<Set<string>>(new Set());
  const [squads, setSquads] = useState<Squad[]>([]);
  const [expandedSquad, setExpandedSquad] = useState<string | null>(null);
  const [batchLoading, setBatchLoading] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);
  const [showCreateSquad, setShowCreateSquad] = useState(false);
  const [newSquadName, setNewSquadName] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Load squads from localStorage on mount
  useEffect(() => {
    setSquads(loadSquads());
  }, []);

  // Auto-clear batch results after 5 seconds
  useEffect(() => {
    if (!batchResult) return;
    const timer = setTimeout(() => setBatchResult(null), 5000);
    return () => clearTimeout(timer);
  }, [batchResult]);

  // ---- Selection ----

  const toggleBot = useCallback((name: string) => {
    setSelectedBots((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedBots(new Set(bots.map((b) => b.name)));
  }, [bots]);

  const deselectAll = useCallback(() => {
    setSelectedBots(new Set());
  }, []);

  // ---- Batch commands ----

  const runBatchCommand = useCallback(
    async (command: string, targetBots?: string[]) => {
      const names = targetBots ?? Array.from(selectedBots);
      if (names.length === 0) return;

      setBatchLoading(command);
      setBatchResult(null);

      const results: BatchResult = { total: names.length, succeeded: 0, failed: 0, errors: [] };

      await Promise.all(
        names.map(async (botName) => {
          try {
            switch (command) {
              case 'stop':
                await api.stopBot(botName);
                break;
              case 'pause':
                await api.pauseBot(botName);
                break;
              case 'resume':
                await api.resumeBot(botName);
                break;
              default:
                throw new Error(`Unknown command: ${command}`);
            }
            results.succeeded++;
          } catch (e: any) {
            results.failed++;
            results.errors.push({ botName, error: e.message || 'Unknown error' });
          }
        }),
      );

      setBatchResult(results);
      setBatchLoading(null);
    },
    [selectedBots],
  );

  // ---- Squad management ----

  const nextSquadName = useCallback(() => {
    const existing = squads.map((s) => s.name);
    let i = 1;
    while (existing.includes(`Squad ${i}`)) i++;
    return `Squad ${i}`;
  }, [squads]);

  const openCreateSquad = useCallback(() => {
    setNewSquadName(nextSquadName());
    setShowCreateSquad(true);
  }, [nextSquadName]);

  const createSquad = useCallback(() => {
    const name = newSquadName.trim();
    if (!name || selectedBots.size === 0) return;
    const squad: Squad = {
      id: `squad-${Date.now()}`,
      name,
      botNames: Array.from(selectedBots),
      createdAt: Date.now(),
    };
    const updated = [...squads, squad];
    setSquads(updated);
    saveSquads(updated);
    setShowCreateSquad(false);
    setNewSquadName('');
    setSelectedBots(new Set());
    setExpandedSquad(squad.id);
  }, [newSquadName, selectedBots, squads]);

  const deleteSquad = useCallback(
    (id: string) => {
      const updated = squads.filter((s) => s.id !== id);
      setSquads(updated);
      saveSquads(updated);
      setDeleteConfirm(null);
      if (expandedSquad === id) setExpandedSquad(null);
    },
    [squads, expandedSquad],
  );

  // ---- Helpers ----

  function getBotData(name: string): BotLiveData | undefined {
    return bots.find((b) => b.name === name);
  }

  const isOnline = (name: string) => {
    const bot = getBotData(name);
    return bot ? bot.state !== 'DISCONNECTED' : false;
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <PageHeader title="Fleet Management" subtitle="Organize bots into squads and issue batch commands" />
        <div className="flex items-center gap-2">
          <button
            onClick={selectAll}
            className="text-xs text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/40 transition-colors"
          >
            Select All
          </button>
          <button
            onClick={deselectAll}
            className="text-xs text-zinc-400 hover:text-white px-3 py-1.5 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/40 transition-colors"
          >
            Deselect All
          </button>
        </div>
      </div>

      {/* Batch result banner */}
      <AnimatePresence>
        {batchResult && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={`text-sm px-4 py-3 rounded-lg border ${
              batchResult.failed === 0
                ? 'bg-emerald-400/10 border-emerald-400/20 text-emerald-400'
                : 'bg-amber-400/10 border-amber-400/20 text-amber-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span>
                {batchResult.succeeded}/{batchResult.total} succeeded
                {batchResult.failed > 0 && `, ${batchResult.failed} failed`}
              </span>
              <button
                onClick={() => setBatchResult(null)}
                className="text-zinc-500 hover:text-zinc-300 ml-3"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            {batchResult.errors.length > 0 && (
              <div className="mt-2 space-y-1">
                {batchResult.errors.map((err, i) => (
                  <div key={i} className="text-xs text-red-400 flex items-center gap-2">
                    <span className="font-medium text-red-300">{err.botName}:</span>
                    <span>{err.error}</span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bot grid for selection */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
          All Bots ({bots.length})
        </h2>
        {bots.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40"
          >
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
            </div>
            <p className="text-sm text-zinc-500">No bots online</p>
            <p className="text-xs text-zinc-600 mt-1">
              <Link href="/manage" className="text-emerald-500 hover:text-emerald-400">
                Create a bot
              </Link>{' '}
              to start building your fleet
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {bots.map((bot, i) => {
              const selected = selectedBots.has(bot.name);
              const accentColor = getPersonalityColor(bot.personality);
              const stateColor = STATE_COLORS[bot.state] ?? '#6B7280';
              const stateLabel = STATE_LABELS[bot.state] ?? bot.state;
              const online = bot.state !== 'DISCONNECTED';
              const emoji = PERSONALITY_ICONS[bot.personality?.toLowerCase()] ?? '';

              return (
                <motion.div
                  key={bot.name}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.03 }}
                  onClick={() => toggleBot(bot.name)}
                  className={`cursor-pointer bg-zinc-900/80 border rounded-xl transition-all duration-200 overflow-hidden hover:shadow-lg hover:shadow-black/20 ${
                    selected
                      ? 'border-emerald-500/50 ring-1 ring-emerald-500/20'
                      : 'border-zinc-800/60 hover:border-zinc-600/60'
                  }`}
                >
                  {/* Accent bar */}
                  <div
                    className="h-0.5"
                    style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}80)` }}
                  />

                  <div className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Selection checkbox */}
                        <div
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            selected
                              ? 'bg-emerald-500 border-emerald-500'
                              : 'border-zinc-600 hover:border-zinc-500'
                          }`}
                        >
                          {selected && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm shrink-0"
                          style={{ backgroundColor: `${accentColor}15` }}
                        >
                          {emoji}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-white truncate">{bot.name}</h3>
                          <p className="text-[11px] text-zinc-500 capitalize">{bot.personality}</p>
                        </div>
                      </div>
                      {/* Online indicator */}
                      <span
                        className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${
                          online
                            ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                            : 'bg-zinc-600'
                        }`}
                        title={online ? 'Online' : 'Offline'}
                      />
                    </div>

                    {/* State + task */}
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-medium uppercase px-2 py-0.5 rounded-md"
                        style={{ color: stateColor, backgroundColor: `${stateColor}12` }}
                      >
                        {stateLabel}
                      </span>
                    </div>

                    {/* Health bar */}
                    {bot.health != null && (
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-zinc-500 w-4 shrink-0">HP</span>
                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-red-500 transition-all duration-500"
                            style={{ width: `${Math.max(0, Math.min(100, ((bot.health ?? 20) / 20) * 100))}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-zinc-500 w-6 text-right tabular-nums">
                          {bot.health ?? 20}
                        </span>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* Squads section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Squads ({squads.length})
          </h2>
          {selectedBots.size > 0 && (
            <button
              onClick={openCreateSquad}
              className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
            >
              Create Squad from Selected ({selectedBots.size})
            </button>
          )}
        </div>

        {/* Create squad modal */}
        <AnimatePresence>
          {showCreateSquad && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 mb-3">
                <h3 className="text-sm font-semibold text-white mb-3">Create Squad</h3>
                <div className="flex gap-3">
                  <input
                    value={newSquadName}
                    onChange={(e) => setNewSquadName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && createSquad()}
                    placeholder="Squad name..."
                    className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-4 py-2 text-sm text-white placeholder-zinc-600"
                    autoFocus
                  />
                  <button
                    onClick={createSquad}
                    disabled={!newSquadName.trim() || selectedBots.size === 0}
                    className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => setShowCreateSquad(false)}
                    className="text-zinc-500 hover:text-zinc-300 px-3 py-2 rounded-lg text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Array.from(selectedBots).map((name) => (
                    <span
                      key={name}
                      className="text-[11px] bg-zinc-800 text-zinc-300 px-2 py-0.5 rounded border border-zinc-700/40"
                    >
                      {name}
                    </span>
                  ))}
                </div>
                {selectedBots.size === 0 && (
                  <p className="text-xs text-amber-400 mt-2">Select at least 1 bot above</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Squad list */}
        {squads.length === 0 && !showCreateSquad ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-12 bg-zinc-900/50 rounded-xl border border-zinc-800/40"
          >
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <p className="text-sm text-zinc-500">No squads yet</p>
            <p className="text-xs text-zinc-600 mt-1">
              Select bots above, then click{' '}
              <button
                onClick={() => {
                  if (bots.length > 0 && selectedBots.size === 0) selectAll();
                  openCreateSquad();
                }}
                className="text-emerald-500 hover:text-emerald-400"
              >
                Create your first squad
              </button>
            </p>
          </motion.div>
        ) : (
          <div className="space-y-3">
            {squads.map((squad) => {
              const isExpanded = expandedSquad === squad.id;
              const members = squad.botNames.map((n) => getBotData(n)).filter(Boolean) as BotLiveData[];
              const onlineCount = squad.botNames.filter(isOnline).length;

              return (
                <motion.div
                  key={squad.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
                >
                  {/* Squad header */}
                  <div
                    onClick={() => setExpandedSquad(isExpanded ? null : squad.id)}
                    className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-zinc-800/20 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#6B7280"
                        strokeWidth="2"
                        className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      <h3 className="text-sm font-semibold text-white">{squad.name}</h3>
                      <span className="text-xs text-zinc-500">
                        {squad.botNames.length} bot{squad.botNames.length !== 1 ? 's' : ''}
                        {' / '}
                        <span className={onlineCount > 0 ? 'text-emerald-400' : 'text-zinc-600'}>
                          {onlineCount} online
                        </span>
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Batch commands for squad */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          runBatchCommand('stop', squad.botNames);
                        }}
                        disabled={batchLoading === 'stop'}
                        className="text-[11px] text-zinc-500 hover:text-red-400 px-2 py-1 rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-50"
                        title="Stop all in squad"
                      >
                        {batchLoading === 'stop' ? (
                          <span className="w-3 h-3 border-2 border-zinc-500/30 border-t-zinc-400 rounded-full animate-spin inline-block" />
                        ) : (
                          'Stop'
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          runBatchCommand('pause', squad.botNames);
                        }}
                        disabled={batchLoading === 'pause'}
                        className="text-[11px] text-zinc-500 hover:text-amber-400 px-2 py-1 rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-50"
                        title="Pause all in squad"
                      >
                        {batchLoading === 'pause' ? (
                          <span className="w-3 h-3 border-2 border-zinc-500/30 border-t-zinc-400 rounded-full animate-spin inline-block" />
                        ) : (
                          'Pause'
                        )}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          runBatchCommand('resume', squad.botNames);
                        }}
                        disabled={batchLoading === 'resume'}
                        className="text-[11px] text-zinc-500 hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-50"
                        title="Resume all in squad"
                      >
                        {batchLoading === 'resume' ? (
                          <span className="w-3 h-3 border-2 border-zinc-500/30 border-t-zinc-400 rounded-full animate-spin inline-block" />
                        ) : (
                          'Resume'
                        )}
                      </button>

                      {/* Delete with confirmation */}
                      {deleteConfirm === squad.id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <span className="text-[11px] text-amber-400">Delete?</span>
                          <button
                            onClick={() => deleteSquad(squad.id)}
                            className="text-[11px] text-red-400 hover:text-red-300 px-1.5 py-0.5 rounded bg-red-400/10 hover:bg-red-400/20 transition-colors"
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="text-[11px] text-zinc-500 hover:text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800 transition-colors"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(squad.id);
                          }}
                          className="text-zinc-600 hover:text-red-400 px-1.5 py-1 rounded-md hover:bg-zinc-800 transition-colors"
                          title="Delete squad"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded squad detail */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-zinc-800/40 px-5 py-3">
                          {members.length === 0 ? (
                            <div className="text-center py-6">
                              <p className="text-xs text-zinc-500">Add bots to this squad</p>
                              <p className="text-[11px] text-zinc-600 mt-1">
                                The bots in this squad may have been removed. Delete this squad and create a new one.
                              </p>
                            </div>
                          ) : (
                            <div className="divide-y divide-zinc-800/30">
                              {squad.botNames.map((name) => {
                                const bot = getBotData(name);
                                if (!bot) {
                                  return (
                                    <div key={name} className="flex items-center gap-3 py-2.5">
                                      <span className="w-2.5 h-2.5 rounded-full bg-zinc-700 shrink-0" />
                                      <span className="text-sm text-zinc-600">{name}</span>
                                      <span className="text-[10px] text-zinc-700 italic">not found</span>
                                    </div>
                                  );
                                }

                                const online = bot.state !== 'DISCONNECTED';
                                const stateColor = STATE_COLORS[bot.state] ?? '#6B7280';
                                const stateLabel = STATE_LABELS[bot.state] ?? bot.state;
                                const accentColor = getPersonalityColor(bot.personality);
                                const emoji = PERSONALITY_ICONS[bot.personality?.toLowerCase()] ?? '';

                                return (
                                  <div key={name} className="flex items-center gap-3 py-2.5">
                                    {/* Online indicator */}
                                    <span
                                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                        online
                                          ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                                          : 'bg-zinc-600'
                                      }`}
                                    />

                                    {/* Bot icon */}
                                    <div
                                      className="w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0"
                                      style={{ backgroundColor: `${accentColor}15` }}
                                    >
                                      {emoji}
                                    </div>

                                    {/* Name + personality */}
                                    <div className="min-w-0 flex-1">
                                      <Link
                                        href={`/bots/${bot.name}`}
                                        className="text-sm font-medium text-white hover:underline"
                                      >
                                        {bot.name}
                                      </Link>
                                      <span className="text-[10px] text-zinc-500 capitalize ml-2">
                                        {bot.personality}
                                      </span>
                                    </div>

                                    {/* State */}
                                    <span
                                      className="text-[10px] font-medium uppercase px-2 py-0.5 rounded-md shrink-0"
                                      style={{ color: stateColor, backgroundColor: `${stateColor}12` }}
                                    >
                                      {stateLabel}
                                    </span>

                                    {/* Health bar */}
                                    {bot.health != null && (
                                      <div className="flex items-center gap-1 w-24 shrink-0">
                                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                          <div
                                            className="h-full rounded-full bg-red-500 transition-all duration-500"
                                            style={{
                                              width: `${Math.max(0, Math.min(100, ((bot.health ?? 20) / 20) * 100))}%`,
                                            }}
                                          />
                                        </div>
                                        <span className="text-[10px] text-zinc-500 tabular-nums w-4 text-right">
                                          {bot.health ?? 20}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      {/* Floating selection bar */}
      {selectedBots.size > 0 && (
        <FleetSelectionBar
          selectedCount={selectedBots.size}
          onStop={() => runBatchCommand('stop')}
          onPause={() => runBatchCommand('pause')}
          onResume={() => runBatchCommand('resume')}
          onCreateSquad={openCreateSquad}
          onDeselectAll={deselectAll}
          loading={batchLoading}
        />
      )}
    </div>
  );
}
