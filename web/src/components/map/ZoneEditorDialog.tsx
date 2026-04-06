'use client';

import { useState } from 'react';
import { useMapOverlayStore } from '@/lib/mapStore';
import { api } from '@/lib/api';
import type { Zone } from '@/lib/api';

const ZONE_TYPES: Zone['type'][] = ['guard', 'build', 'farm', 'restricted', 'custom'];

export function ZoneEditorDialog() {
  const show = useMapOverlayStore((s) => s.showZoneDialog);
  const coords = useMapOverlayStore((s) => s.zoneDialogCoords);
  const closeZoneDialog = useMapOverlayStore((s) => s.closeZoneDialog);
  const addZone = useMapOverlayStore((s) => s.addZone);
  const setActiveTool = useMapOverlayStore((s) => s.setActiveTool);

  const [name, setName] = useState('');
  const [type, setType] = useState<Zone['type']>('guard');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!show || !coords) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await api.createZone({
        name: name.trim(),
        type,
        shape: 'rect',
        x1: Math.min(coords.x1, coords.x2),
        z1: Math.min(coords.z1, coords.z2),
        x2: Math.max(coords.x1, coords.x2),
        z2: Math.max(coords.z1, coords.z2),
      });
      addZone(result.zone);
      setName('');
      setType('guard');
      closeZoneDialog();
      setActiveTool('select');
    } catch (e: any) {
      setError(e.message || 'Failed to create zone');
    }
    setSaving(false);
  };

  const handleCancel = () => {
    setName('');
    setType('guard');
    setError('');
    closeZoneDialog();
    setActiveTool('select');
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl p-5 w-80 shadow-2xl">
        <h3 className="text-sm font-bold text-white mb-4">Create Zone</h3>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="e.g. Farm Area"
              className="w-full bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
              autoFocus
            />
          </div>

          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Type</label>
            <div className="flex flex-wrap gap-1.5">
              {ZONE_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                    type === t
                      ? 'bg-violet-600/20 border-violet-500/40 text-violet-300'
                      : 'bg-zinc-800/60 border-zinc-700/30 text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-zinc-800/50 rounded-lg px-3 py-2 text-[10px] font-mono text-zinc-400">
            <span className="text-zinc-600">Bounds: </span>
            ({Math.round(coords.x1)}, {Math.round(coords.z1)}) to ({Math.round(coords.x2)}, {Math.round(coords.z2)})
          </div>

          {error && <p className="text-[10px] text-red-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleCancel}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs text-zinc-400 bg-zinc-800 hover:bg-zinc-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Create Zone'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
