'use client';

import { useState, useEffect } from 'react';
import { api, type Marker } from '@/lib/api';
import { useToast } from '@/components/Toast';

const MARKER_COLORS = ['#F59E0B', '#EF4444', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#F97316', '#14B8A6'];

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (marker: Marker) => void;
  defaultPosition?: { x: number; z: number };
}

export function MarkerEditor({ open, onClose, onCreated, defaultPosition }: Props) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [x, setX] = useState(defaultPosition?.x ?? 0);
  const [y, setY] = useState(64);
  const [z, setZ] = useState(defaultPosition?.z ?? 0);
  const [color, setColor] = useState('#F59E0B');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (defaultPosition) {
      setX(Math.round(defaultPosition.x));
      setZ(Math.round(defaultPosition.z));
    }
  }, [defaultPosition]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await api.createMarker({
        name: name.trim(),
        x, y, z,
        color,
        notes: notes.trim() || undefined,
      });
      toast(`Marker "${name}" created`, 'success');
      onCreated(res.marker);
      onClose();
      setName('');
      setNotes('');
    } catch (e: unknown) {
      toast((e as Error).message || 'Failed to create marker', 'error');
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl w-full max-w-sm">
        <div className="px-5 py-4 border-b border-zinc-800/60 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Create Marker</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Home Base"
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
              autoFocus
            />
          </div>

          {/* Position */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">X</label>
              <input
                type="number"
                value={x}
                onChange={(e) => setX(Number(e.target.value))}
                className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Y</label>
              <input
                type="number"
                value={y}
                onChange={(e) => setY(Number(e.target.value))}
                className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Z</label>
              <input
                type="number"
                value={z}
                onChange={(e) => setZ(Number(e.target.value))}
                className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
              />
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Color</label>
            <div className="flex gap-1.5">
              {MARKER_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-all ${color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Notes (optional)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes..."
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-zinc-800/60 flex justify-end gap-2">
          <button onClick={onClose} className="text-xs text-zinc-400 hover:text-zinc-200 px-4 py-2 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
          >
            {submitting ? 'Creating...' : 'Create Marker'}
          </button>
        </div>
      </div>
    </div>
  );
}
