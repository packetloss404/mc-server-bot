'use client';

import { useState } from 'react';
import type { DrawnZone } from './mapDrawing';

const ZONE_TYPES = ['guard', 'farm', 'build', 'mine', 'other'] as const;

interface Props {
  zone: DrawnZone;
  onSave: (data: { name: string; type: string; zone: DrawnZone }) => void;
  onCancel: () => void;
}

export default function ZoneEditorDialog({ zone, onSave, onCancel }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<string>('guard');

  const coordsLabel =
    zone.shape === 'circular'
      ? `Center: ${zone.cx}, ${zone.cz}  Radius: ${zone.radius}`
      : `From (${zone.x1}, ${zone.z1}) to (${zone.x2}, ${zone.z2})`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl w-[380px] p-5">
        <h2 className="text-sm font-bold text-white mb-4">Create Zone</h2>

        {/* Coordinate summary */}
        <div className="mb-4 px-3 py-2 rounded-md bg-zinc-800/80 border border-zinc-700/40">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">
            {zone.shape === 'circular' ? 'Circle' : 'Rectangle'}
          </p>
          <p className="text-xs text-zinc-300 font-mono">{coordsLabel}</p>
        </div>

        {/* Name */}
        <label className="block mb-3">
          <span className="text-[11px] text-zinc-400 block mb-1">Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            placeholder="e.g. North Farm"
            className="w-full px-3 py-1.5 rounded-md bg-zinc-800 border border-zinc-700/60 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-blue-500/60"
          />
        </label>

        {/* Type */}
        <label className="block mb-5">
          <span className="text-[11px] text-zinc-400 block mb-1">Type</span>
          <div className="flex gap-1.5 flex-wrap">
            {ZONE_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-2.5 py-1 rounded text-[11px] font-medium capitalize transition-colors ${
                  type === t
                    ? 'bg-blue-600/30 text-blue-300 border border-blue-500/40'
                    : 'bg-zinc-800 text-zinc-400 border border-zinc-700/40 hover:bg-zinc-700/60'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </label>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[11px] rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (!name.trim()) return;
              onSave({ name: name.trim(), type, zone });
            }}
            disabled={!name.trim()}
            className="px-4 py-1.5 text-[11px] rounded-md bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Create Zone
          </button>
        </div>
      </div>
    </div>
  );
}
