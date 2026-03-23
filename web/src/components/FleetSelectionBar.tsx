'use client';

import { motion } from 'framer-motion';

interface FleetSelectionBarProps {
  selectedCount: number;
  onStop: () => void;
  onPause: () => void;
  onResume: () => void;
  onCreateSquad: () => void;
  onDeselectAll: () => void;
  loading: string | null;
}

function Spinner() {
  return (
    <span className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin inline-block" />
  );
}

export function FleetSelectionBar({
  selectedCount,
  onStop,
  onPause,
  onResume,
  onCreateSquad,
  onDeselectAll,
  loading,
}: FleetSelectionBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/60 rounded-2xl px-5 py-3 shadow-2xl shadow-black/40"
    >
      <span className="text-sm text-zinc-300 font-medium mr-1">
        {selectedCount} bot{selectedCount !== 1 ? 's' : ''} selected
      </span>

      <div className="w-px h-5 bg-zinc-700/60" />

      <button
        onClick={onStop}
        disabled={loading === 'stop'}
        className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 bg-red-400/10 hover:bg-red-400/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
      >
        {loading === 'stop' ? <Spinner /> : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        )}
        Stop All
      </button>

      <button
        onClick={onPause}
        disabled={loading === 'pause'}
        className="flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 bg-amber-400/10 hover:bg-amber-400/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
      >
        {loading === 'pause' ? <Spinner /> : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        )}
        Pause All
      </button>

      <button
        onClick={onResume}
        disabled={loading === 'resume'}
        className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-400/10 hover:bg-emerald-400/20 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
      >
        {loading === 'resume' ? <Spinner /> : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        )}
        Resume All
      </button>

      <div className="w-px h-5 bg-zinc-700/60" />

      <button
        onClick={onCreateSquad}
        className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-400/10 hover:bg-blue-400/20 px-3 py-1.5 rounded-lg transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Squad
      </button>

      <button
        onClick={onDeselectAll}
        className="text-zinc-500 hover:text-zinc-300 ml-1 p-1 rounded-md hover:bg-zinc-800 transition-colors"
        title="Deselect all"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  );
}
