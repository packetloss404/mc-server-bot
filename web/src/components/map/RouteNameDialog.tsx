'use client';

import { useState } from 'react';
import { useMapOverlayStore } from '@/lib/mapStore';
import { api } from '@/lib/api';

export function RouteNameDialog() {
  const show = useMapOverlayStore((s) => s.showRouteDialog);
  const waypoints = useMapOverlayStore((s) => s.routeWaypoints);
  const closeRouteDialog = useMapOverlayStore((s) => s.closeRouteDialog);
  const clearRouteWaypoints = useMapOverlayStore((s) => s.clearRouteWaypoints);
  const addRoute = useMapOverlayStore((s) => s.addRoute);
  const setActiveTool = useMapOverlayStore((s) => s.setActiveTool);

  const [name, setName] = useState('');
  const [loop, setLoop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!show || waypoints.length < 2) return null;

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const result = await api.createRoute({
        name: name.trim(),
        waypoints: [...waypoints],
        loop,
      });
      addRoute(result.route);
      setName('');
      setLoop(false);
      closeRouteDialog();
      clearRouteWaypoints();
      setActiveTool('select');
    } catch (e: any) {
      setError(e.message || 'Failed to create route');
    }
    setSaving(false);
  };

  const handleCancel = () => {
    setName('');
    setLoop(false);
    setError('');
    closeRouteDialog();
    clearRouteWaypoints();
    setActiveTool('select');
  };

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-xl p-5 w-80 shadow-2xl">
        <h3 className="text-sm font-bold text-white mb-4">Create Route</h3>

        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider block mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              placeholder="e.g. North Patrol"
              className="w-full bg-zinc-800 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
              autoFocus
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-800 text-violet-500"
            />
            <span className="text-[11px] text-zinc-400">Loop route (connect last waypoint to first)</span>
          </label>

          <div className="bg-zinc-800/50 rounded-lg px-3 py-2 text-[10px] font-mono text-zinc-400">
            <span className="text-zinc-600">Waypoints: </span>{waypoints.length}
            <div className="mt-1 max-h-20 overflow-y-auto space-y-0.5">
              {waypoints.map((wp, i) => (
                <div key={i} className="text-zinc-500">
                  {i + 1}. ({Math.round(wp.x)}, {Math.round(wp.z)})
                </div>
              ))}
            </div>
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
              className="flex-1 px-3 py-1.5 rounded-lg text-xs text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Create Route'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
