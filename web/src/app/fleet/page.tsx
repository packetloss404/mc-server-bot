'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBotStore, useFleetStore, useControlStore, type Squad } from '@/lib/store';
import { api } from '@/lib/api';
import { FleetSelectionBar } from '@/components/FleetSelectionBar';

export default function FleetPage() {
  const bots = useBotStore((s) => s.botList);
  const squads = useFleetStore((s) => s.squads);
  const selectedSquadId = useFleetStore((s) => s.selectedSquadId);
  const selectSquad = useFleetStore((s) => s.selectSquad);
  const addSquad = useFleetStore((s) => s.addSquad);
  const removeSquad = useFleetStore((s) => s.removeSquad);
  const selectedBotIds = useControlStore((s) => s.selectedBotIds);
  const toggleBotSelection = useControlStore((s) => s.toggleBotSelection);

  const [showCreate, setShowCreate] = useState(false);
  const selectedSquad = squads.find((s) => s.id === selectedSquadId) ?? null;

  return (
    <div className="p-6 lg:p-8 max-w-[1400px] space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Fleet Management</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Organize bots into squads and execute batch commands
        </p>
      </div>

      {/* Selection bar for quick bot selection */}
      <QuickSelectBar bots={bots} selectedBotIds={selectedBotIds} toggleBotSelection={toggleBotSelection} />

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Squad list */}
        <div className="lg:col-span-1 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Squads ({squads.length})
            </h2>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
            >
              {showCreate ? 'Cancel' : '+ Create Squad'}
            </button>
          </div>

          <AnimatePresence>
            {showCreate && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <CreateSquadForm
                  bots={bots}
                  onCreated={(squad) => {
                    setShowCreate(false);
                    selectSquad(squad.id);
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {squads.length === 0 && !showCreate ? (
            <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-8 text-center">
              <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <p className="text-sm text-zinc-500">No squads yet</p>
              <p className="text-xs text-zinc-600 mt-1">Create a squad to organize your bots</p>
            </div>
          ) : (
            <div className="space-y-2">
              {squads.map((squad) => (
                <SquadCard
                  key={squad.id}
                  squad={squad}
                  isSelected={squad.id === selectedSquadId}
                  onSelect={() => selectSquad(squad.id === selectedSquadId ? null : squad.id)}
                  onDelete={() => removeSquad(squad.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: Squad detail */}
        <div className="lg:col-span-2">
          {selectedSquad ? (
            <SquadDetail squad={selectedSquad} bots={bots} />
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-12 text-center">
              <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <p className="text-sm text-zinc-400">Select a squad</p>
              <p className="text-xs text-zinc-600 mt-1">Choose a squad from the left to view details and run commands</p>
            </div>
          )}
        </div>
      </div>

      <FleetSelectionBar />
    </div>
  );
}

/* ---- Quick Select Bar ---- */
function QuickSelectBar({
  bots,
  selectedBotIds,
  toggleBotSelection,
}: {
  bots: { name: string; state: string }[];
  selectedBotIds: Set<string>;
  toggleBotSelection: (name: string) => void;
}) {
  const selectAll = useControlStore((s) => s.selectAll);
  const clearSelection = useControlStore((s) => s.clearSelection);
  const allSelected = bots.length > 0 && bots.every((b) => selectedBotIds.has(b.name));

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Quick Select</h3>
        <button
          onClick={() => allSelected ? clearSelection() : selectAll(bots.map((b) => b.name))}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {bots.map((bot) => {
          const selected = selectedBotIds.has(bot.name);
          return (
            <button
              key={bot.name}
              onClick={() => toggleBotSelection(bot.name)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-all duration-150 ${
                selected
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                  : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-400 hover:border-zinc-600'
              }`}
            >
              {selected && (
                <svg className="inline w-3 h-3 mr-1.5 -mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {bot.name}
            </button>
          );
        })}
        {bots.length === 0 && (
          <span className="text-xs text-zinc-600">No bots online</span>
        )}
      </div>
    </div>
  );
}

/* ---- Create Squad Form ---- */
function CreateSquadForm({
  bots,
  onCreated,
}: {
  bots: { name: string }[];
  onCreated: (squad: Squad) => void;
}) {
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const addSquad = useFleetStore((s) => s.addSquad);

  const toggleBot = (botName: string) => {
    const next = new Set(selected);
    if (next.has(botName)) next.delete(botName);
    else next.add(botName);
    setSelected(next);
  };

  const handleCreate = () => {
    if (!name.trim() || selected.size === 0) return;
    const squad = addSquad(name.trim(), Array.from(selected));
    onCreated(squad);
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 space-y-3">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Squad name..."
        autoFocus
        className="w-full text-sm bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 focus:outline-none focus:border-emerald-500 transition-colors"
      />
      <div>
        <p className="text-xs text-zinc-500 mb-2">Select members:</p>
        <div className="flex flex-wrap gap-1.5">
          {bots.map((bot) => {
            const isSelected = selected.has(bot.name);
            return (
              <button
                key={bot.name}
                onClick={() => toggleBot(bot.name)}
                className={`text-[11px] px-2.5 py-1 rounded-md border transition-colors ${
                  isSelected
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
                    : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                {bot.name}
              </button>
            );
          })}
          {bots.length === 0 && <span className="text-xs text-zinc-600">No bots online</span>}
        </div>
      </div>
      <button
        onClick={handleCreate}
        disabled={!name.trim() || selected.size === 0}
        className="w-full text-xs font-medium py-2 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Create Squad ({selected.size} bot{selected.size !== 1 ? 's' : ''})
      </button>
    </div>
  );
}

/* ---- Squad Card ---- */
function SquadCard({
  squad,
  isSelected,
  onSelect,
  onDelete,
}: {
  squad: Squad;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-zinc-900/80 border rounded-xl p-3.5 cursor-pointer transition-all duration-150 ${
        isSelected
          ? 'border-emerald-500/40 shadow-lg shadow-emerald-500/5'
          : 'border-zinc-800/60 hover:border-zinc-700/60'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{squad.name}</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {squad.botNames.length} bot{squad.botNames.length !== 1 ? 's' : ''}
            {squad.botNames.length > 0 && (
              <span className="text-zinc-600 ml-1.5">
                {squad.botNames.slice(0, 3).join(', ')}
                {squad.botNames.length > 3 && ` +${squad.botNames.length - 3}`}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-zinc-600 hover:text-red-400 transition-colors p-1"
          title="Delete squad"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}

/* ---- Squad Detail ---- */
function SquadDetail({
  squad,
  bots,
}: {
  squad: Squad;
  bots: { name: string }[];
}) {
  const updateSquad = useFleetStore((s) => s.updateSquad);
  const addBotToSquad = useFleetStore((s) => s.addBotToSquad);
  const removeBotFromSquad = useFleetStore((s) => s.removeBotFromSquad);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(squad.name);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAddBot, setShowAddBot] = useState(false);

  const nonMembers = bots.filter((b) => !squad.botNames.includes(b.name));

  const handleBatchAction = async (action: 'stop' | 'pause' | 'resume') => {
    setActionLoading(action);
    try {
      await Promise.all(
        squad.botNames.map((name) => {
          if (action === 'stop') return api.stopBot(name);
          if (action === 'pause') return api.pauseBot(name);
          return api.resumeBot(name);
        }),
      );
    } catch {
      // ignore individual failures
    }
    setActionLoading(null);
  };

  const saveName = () => {
    if (nameValue.trim() && nameValue.trim() !== squad.name) {
      updateSquad(squad.id, { name: nameValue.trim() });
    }
    setEditingName(false);
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-zinc-800/40">
        <div className="flex items-center justify-between">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveName()}
                onBlur={saveName}
                autoFocus
                className="text-lg font-bold bg-zinc-800 border border-zinc-600 text-white rounded-lg px-3 py-1 focus:outline-none focus:border-emerald-500"
              />
            </div>
          ) : (
            <h2
              className="text-lg font-bold text-white cursor-pointer hover:text-emerald-400 transition-colors"
              onClick={() => { setNameValue(squad.name); setEditingName(true); }}
              title="Click to rename"
            >
              {squad.name}
              <svg className="inline w-3.5 h-3.5 ml-2 text-zinc-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </h2>
          )}
          <span className="text-xs text-zinc-500">
            {squad.botNames.length} member{squad.botNames.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Batch actions */}
      <div className="px-5 py-3 border-b border-zinc-800/40 flex items-center gap-2">
        <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mr-2">Commands:</span>
        <button
          onClick={() => handleBatchAction('stop')}
          disabled={!!actionLoading}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          {actionLoading === 'stop' ? 'Stopping...' : 'Stop All'}
        </button>
        <button
          onClick={() => handleBatchAction('pause')}
          disabled={!!actionLoading}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
        >
          {actionLoading === 'pause' ? 'Pausing...' : 'Pause All'}
        </button>
        <button
          onClick={() => handleBatchAction('resume')}
          disabled={!!actionLoading}
          className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
        >
          {actionLoading === 'resume' ? 'Resuming...' : 'Resume All'}
        </button>
      </div>

      {/* Member list */}
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Members</h3>
          <button
            onClick={() => setShowAddBot(!showAddBot)}
            className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors"
          >
            {showAddBot ? 'Done' : '+ Add Bot'}
          </button>
        </div>

        <AnimatePresence>
          {showAddBot && nonMembers.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-1.5 pb-3 border-b border-zinc-800/40">
                {nonMembers.map((bot) => (
                  <button
                    key={bot.name}
                    onClick={() => addBotToSquad(squad.id, bot.name)}
                    className="text-[11px] px-2.5 py-1 rounded-md border border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-emerald-500/40 hover:text-emerald-400 transition-colors"
                  >
                    + {bot.name}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {squad.botNames.length === 0 ? (
          <p className="text-xs text-zinc-600 py-4 text-center">No members in this squad</p>
        ) : (
          <div className="space-y-1.5">
            {squad.botNames.map((name) => (
              <div
                key={name}
                className="flex items-center justify-between bg-zinc-800/40 rounded-lg px-3 py-2.5"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-6 h-6 rounded bg-zinc-700/60 flex items-center justify-center">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <span className="text-sm text-white font-medium">{name}</span>
                </div>
                <button
                  onClick={() => removeBotFromSquad(squad.id, name)}
                  className="text-zinc-600 hover:text-red-400 transition-colors p-1"
                  title="Remove from squad"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
