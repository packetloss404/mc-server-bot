'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useControlStore, useFleetStore } from '@/lib/store';
import { api } from '@/lib/api';

export function FleetSelectionBar() {
  const selectedBotIds = useControlStore((s) => s.selectedBotIds);
  const clearSelection = useControlStore((s) => s.clearSelection);
  const addSquad = useFleetStore((s) => s.addSquad);
  const [showNameInput, setShowNameInput] = useState(false);
  const [squadName, setSquadName] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const count = selectedBotIds.size;
  const botNames = Array.from(selectedBotIds);

  const handleStopAll = async () => {
    setActionLoading('stop');
    try {
      await Promise.all(botNames.map((name) => api.stopBot(name)));
    } catch {
      // ignore individual failures
    }
    setActionLoading(null);
  };

  const handlePauseAll = async () => {
    setActionLoading('pause');
    try {
      await Promise.all(botNames.map((name) => api.pauseBot(name)));
    } catch {
      // ignore
    }
    setActionLoading(null);
  };

  const handleCreateSquad = () => {
    if (!squadName.trim()) return;
    addSquad(squadName.trim(), botNames);
    setSquadName('');
    setShowNameInput(false);
  };

  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
        >
          <div className="bg-zinc-900/95 backdrop-blur-lg border border-zinc-700/60 rounded-2xl shadow-2xl shadow-black/40 px-5 py-3 flex items-center gap-4">
            {/* Bot count & names */}
            <div className="flex items-center gap-2.5">
              <span className="bg-emerald-500/20 text-emerald-400 text-xs font-bold px-2.5 py-1 rounded-lg">
                {count}
              </span>
              <div className="text-sm text-zinc-300">
                <span className="font-medium">bot{count !== 1 ? 's' : ''} selected</span>
                <span className="text-zinc-500 ml-2 text-xs hidden sm:inline">
                  {botNames.slice(0, 3).join(', ')}
                  {botNames.length > 3 && ` +${botNames.length - 3}`}
                </span>
              </div>
            </div>

            <div className="w-px h-6 bg-zinc-700/60" />

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={handleStopAll}
                disabled={actionLoading === 'stop'}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'stop' ? 'Stopping...' : 'Stop All'}
              </button>
              <button
                onClick={handlePauseAll}
                disabled={actionLoading === 'pause'}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
              >
                {actionLoading === 'pause' ? 'Pausing...' : 'Pause All'}
              </button>

              {showNameInput ? (
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={squadName}
                    onChange={(e) => setSquadName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateSquad()}
                    placeholder="Squad name..."
                    autoFocus
                    className="w-32 text-xs bg-zinc-800 border border-zinc-600 text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    onClick={handleCreateSquad}
                    disabled={!squadName.trim()}
                    className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => { setShowNameInput(false); setSquadName(''); }}
                    className="text-xs text-zinc-500 hover:text-zinc-300 px-1"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowNameInput(true)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                >
                  Group as Squad
                </button>
              )}
            </div>

            <div className="w-px h-6 bg-zinc-700/60" />

            <button
              onClick={clearSelection}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1"
            >
              Clear
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
