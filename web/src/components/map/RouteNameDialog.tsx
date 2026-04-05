'use client';

import { useState, useRef, useEffect } from 'react';

interface RouteNameDialogProps {
  waypointCount: number;
  onConfirm: (name: string, description: string) => void;
  onCancel: () => void;
}

export function RouteNameDialog({ waypointCount, onConfirm, onCancel }: RouteNameDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed, description.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onKeyDown={handleKeyDown}>
      <form
        onSubmit={handleSubmit}
        className="bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-2xl p-5 w-[360px] space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-sm font-bold text-white">Save Route</h2>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {waypointCount} waypoint{waypointCount !== 1 ? 's' : ''} placed
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-zinc-400 mb-1">Route Name *</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Mine to Base"
              className="w-full px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-zinc-400 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="w-full px-3 py-1.5 rounded bg-zinc-800 border border-zinc-700 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="px-3 py-1.5 rounded text-[11px] bg-amber-600 hover:bg-amber-500 text-white font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save Route
          </button>
        </div>
      </form>
    </div>
  );
}
