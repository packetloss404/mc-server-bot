'use client';

import { useState, useEffect } from 'react';
import type { MarkerRecord, MarkerKind } from '@/lib/api';

const MARKER_KINDS: { value: MarkerKind; label: string }[] = [
  { value: 'base', label: 'Base' },
  { value: 'storage', label: 'Storage' },
  { value: 'build-site', label: 'Build Site' },
  { value: 'mine', label: 'Mine' },
  { value: 'village', label: 'Village' },
  { value: 'custom', label: 'Custom' },
];

interface MarkerEditorProps {
  marker?: MarkerRecord | null;
  defaultX?: number;
  defaultZ?: number;
  onSave: (data: { name: string; kind: MarkerKind; x: number; y: number; z: number; tags: string[]; notes: string }) => void;
  onCancel: () => void;
}

export default function MarkerEditor({ marker, defaultX, defaultZ, onSave, onCancel }: MarkerEditorProps) {
  const [name, setName] = useState(marker?.name ?? '');
  const [kind, setKind] = useState<MarkerKind>(marker?.kind ?? 'custom');
  const [x, setX] = useState(marker?.x ?? defaultX ?? 0);
  const [y, setY] = useState(marker?.y ?? 64);
  const [z, setZ] = useState(marker?.z ?? defaultZ ?? 0);
  const [tags, setTags] = useState(marker?.tags?.join(', ') ?? '');
  const [notes, setNotes] = useState(marker?.notes ?? '');

  useEffect(() => {
    if (marker) {
      setName(marker.name);
      setKind(marker.kind);
      setX(marker.x);
      setY(marker.y);
      setZ(marker.z);
      setTags(marker.tags?.join(', ') ?? '');
      setNotes(marker.notes ?? '');
    }
  }, [marker]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      kind,
      x: Math.round(x),
      y: Math.round(y),
      z: Math.round(z),
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      notes,
    });
  };

  const inputClass = 'w-full bg-zinc-800 border border-zinc-700/60 rounded px-2 py-1.5 text-[12px] text-zinc-200 focus:outline-none focus:border-zinc-500 placeholder-zinc-600';

  return (
    <div className="bg-zinc-900/95 border border-zinc-700/60 rounded-lg shadow-xl p-4 w-72">
      <h3 className="text-[12px] font-semibold text-zinc-300 mb-3">
        {marker ? 'Edit Marker' : 'Create Marker'}
      </h3>
      <form onSubmit={handleSubmit} className="space-y-2.5">
        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Marker name..."
            className={inputClass}
            autoFocus
          />
        </div>

        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Kind</label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MarkerKind)}
            className={inputClass}
          >
            {MARKER_KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">X</label>
            <input type="number" value={Math.round(x)} onChange={(e) => setX(Number(e.target.value))} className={inputClass} />
          </div>
          <div>
            <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Y</label>
            <input type="number" value={Math.round(y)} onChange={(e) => setY(Number(e.target.value))} className={inputClass} />
          </div>
          <div>
            <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Z</label>
            <input type="number" value={Math.round(z)} onChange={(e) => setZ(Number(e.target.value))} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Tags</label>
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="tag1, tag2, ..."
            className={inputClass}
          />
        </div>

        <div>
          <label className="block text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes..."
            rows={2}
            className={inputClass + ' resize-none'}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={!name.trim()}
            className="flex-1 px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-[11px] font-medium transition-colors"
          >
            {marker ? 'Update' : 'Create'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-[11px] font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
