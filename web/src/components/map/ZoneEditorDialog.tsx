'use client';

import { useState, useEffect, useRef } from 'react';
import { api, type Zone } from '@/lib/api';
import { useToast } from '@/components/Toast';

const ZONE_TYPES: Zone['type'][] = ['guard', 'build', 'farm', 'mine', 'restricted', 'custom'];
const ZONE_COLORS: Record<string, string> = {
  guard: '#4A90D9',
  build: '#1ABC9C',
  farm: '#F39C12',
  mine: '#D97706',
  restricted: '#EF4444',
  custom: '#8B5CF6',
};

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (zone: Zone) => void;
  defaultCenter?: { x: number; z: number };
}

export function ZoneEditorDialog({ open, onClose, onCreated, defaultCenter }: Props) {
  const { toast } = useToast();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<Zone['type']>('guard');
  const [shape, setShape] = useState<'rect' | 'circle'>('rect');
  const [cx, setCx] = useState(defaultCenter?.x ?? 0);
  const [cz, setCz] = useState(defaultCenter?.z ?? 0);
  const [radius, setRadius] = useState(32);
  const [width, setWidth] = useState(64);
  const [height, setHeight] = useState(64);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (defaultCenter) {
      setCx(Math.round(defaultCenter.x));
      setCz(Math.round(defaultCenter.z));
    }
  }, [defaultCenter]);

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
      const data: Omit<Zone, 'id' | 'createdAt'> = {
        name: name.trim(),
        type,
        shape,
        center: { x: cx, z: cz },
        color: ZONE_COLORS[type] || '#8B5CF6',
        notes: notes.trim() || undefined,
        ...(shape === 'circle' ? { radius } : { width, height }),
      };
      const res = await api.createZone(data);
      toast(`Zone "${name}" created`, 'success');
      onCreated(res.zone);
      onClose();
      setName('');
      setNotes('');
    } catch (e: unknown) {
      toast((e as Error).message || 'Failed to create zone', 'error');
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        ref={dialogRef}
        className="bg-zinc-900 border border-zinc-700/60 rounded-xl shadow-2xl w-full max-w-md"
      >
        <div className="px-5 py-4 border-b border-zinc-800/60 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Create Zone</h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-lg leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Village Guard Zone"
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
              autoFocus
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {ZONE_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-2.5 py-1 rounded text-[10px] font-medium capitalize transition-colors ${
                    type === t ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                  style={type === t ? { backgroundColor: `${ZONE_COLORS[t]}20`, color: ZONE_COLORS[t], border: `1px solid ${ZONE_COLORS[t]}30` } : { border: '1px solid transparent' }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Shape */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Shape</label>
            <div className="flex gap-2">
              <button
                onClick={() => setShape('rect')}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                  shape === 'rect' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300 bg-zinc-800/50'
                }`}
              >
                Rectangle
              </button>
              <button
                onClick={() => setShape('circle')}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                  shape === 'circle' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300 bg-zinc-800/50'
                }`}
              >
                Circle
              </button>
            </div>
          </div>

          {/* Center */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Center X</label>
              <input
                type="number"
                value={cx}
                onChange={(e) => setCx(Number(e.target.value))}
                className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Center Z</label>
              <input
                type="number"
                value={cz}
                onChange={(e) => setCz(Number(e.target.value))}
                className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
              />
            </div>
          </div>

          {/* Size */}
          {shape === 'circle' ? (
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Radius</label>
              <input
                type="number"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Width</label>
                <input
                  type="number"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                  className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
                />
              </div>
              <div>
                <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Height</label>
                <input
                  type="number"
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                  className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-zinc-600"
                />
              </div>
            </div>
          )}

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
            {submitting ? 'Creating...' : 'Create Zone'}
          </button>
        </div>
      </div>
    </div>
  );
}
