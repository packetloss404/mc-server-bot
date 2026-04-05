'use client';

import { useState, useEffect } from 'react';
import { api, type Marker, type Zone, type Route } from '@/lib/api';
import { useToast } from '@/components/Toast';

interface MapEntity {
  name: string;
  x: number;
  z: number;
  color: string;
  type: 'bot' | 'player';
  state?: string;
  personality?: string;
}

interface Props {
  entities: MapEntity[];
  selectedEntity: string | null;
  onSelectEntity: (name: string) => void;
  onCenterOn: (x: number, z: number) => void;
}

export function MapEntitySidebar({ entities, selectedEntity, onSelectEntity, onCenterOn }: Props) {
  const { toast } = useToast();
  const [tab, setTab] = useState<'entities' | 'markers' | 'zones' | 'routes'>('entities');
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [routes, setRoutes] = useState<Route[]>([]);

  useEffect(() => {
    if (tab === 'markers') {
      api.getMarkers().then((r) => setMarkers(r.markers)).catch(() => {});
    } else if (tab === 'zones') {
      api.getZones().then((r) => setZones(r.zones)).catch(() => {});
    } else if (tab === 'routes') {
      api.getRoutes().then((r) => setRoutes(r.routes)).catch(() => {});
    }
  }, [tab]);

  const handleDeleteMarker = async (id: string) => {
    try {
      await api.deleteMarker(id);
      setMarkers((prev) => prev.filter((m) => m.id !== id));
      toast('Marker deleted', 'success');
    } catch { toast('Failed to delete marker', 'error'); }
  };

  const handleDeleteZone = async (id: string) => {
    try {
      await api.deleteZone(id);
      setZones((prev) => prev.filter((z) => z.id !== id));
      toast('Zone deleted', 'success');
    } catch { toast('Failed to delete zone', 'error'); }
  };

  const handleDeleteRoute = async (id: string) => {
    try {
      await api.deleteRoute(id);
      setRoutes((prev) => prev.filter((r) => r.id !== id));
      toast('Route deleted', 'success');
    } catch { toast('Failed to delete route', 'error'); }
  };

  return (
    <div className="w-52 border-r border-zinc-800/60 bg-zinc-950/50 overflow-y-auto shrink-0 flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-zinc-800/60 shrink-0">
        {(['entities', 'markers', 'zones', 'routes'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-[9px] font-semibold uppercase tracking-wider transition-colors ${
              tab === t ? 'text-white border-b border-emerald-400' : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {t === 'entities' ? 'Ent' : t.slice(0, 4)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'entities' && (
          <>
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Entities ({entities.length})
            </p>
            <div className="space-y-0.5">
              {entities.map((entity) => (
                <button
                  key={`${entity.type}-${entity.name}`}
                  onClick={() => { onCenterOn(entity.x, entity.z); onSelectEntity(entity.name); }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
                    selectedEntity === entity.name ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'
                  }`}
                >
                  <span className={`w-2.5 h-2.5 shrink-0 ${entity.type === 'player' ? 'rounded-sm' : 'rounded-full'}`} style={{ backgroundColor: entity.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium text-zinc-300 truncate">{entity.name}</p>
                    <p className="text-[9px] text-zinc-600 font-mono tabular-nums">{Math.round(entity.x)}, {Math.round(entity.z)}</p>
                  </div>
                  <span className="text-[9px] text-zinc-600 uppercase shrink-0">
                    {entity.type === 'bot' ? entity.personality?.slice(0, 3) : 'PLR'}
                  </span>
                </button>
              ))}
              {entities.length === 0 && <p className="text-[11px] text-zinc-600 text-center py-4">No entities with positions</p>}
            </div>
          </>
        )}

        {tab === 'markers' && (
          <>
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Markers ({markers.length})
            </p>
            <div className="space-y-0.5">
              {markers.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800/50 group"
                >
                  <button
                    onClick={() => onCenterOn(m.x, m.z)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: m.color || '#F59E0B' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-zinc-300 truncate">{m.name}</p>
                      <p className="text-[9px] text-zinc-600 font-mono">{Math.round(m.x)}, {Math.round(m.z)}</p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleDeleteMarker(m.id)}
                    className="text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-[10px]"
                  >
                    x
                  </button>
                </div>
              ))}
              {markers.length === 0 && <p className="text-[11px] text-zinc-600 text-center py-4">No markers</p>}
            </div>
          </>
        )}

        {tab === 'zones' && (
          <>
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Zones ({zones.length})
            </p>
            <div className="space-y-0.5">
              {zones.map((z) => (
                <div
                  key={z.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800/50 group"
                >
                  <button
                    onClick={() => onCenterOn(z.center.x, z.center.z)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: z.color || '#3B82F6' }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-zinc-300 truncate">{z.name}</p>
                      <p className="text-[9px] text-zinc-600">{z.type} ({z.shape})</p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleDeleteZone(z.id)}
                    className="text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-[10px]"
                  >
                    x
                  </button>
                </div>
              ))}
              {zones.length === 0 && <p className="text-[11px] text-zinc-600 text-center py-4">No zones</p>}
            </div>
          </>
        )}

        {tab === 'routes' && (
          <>
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
              Routes ({routes.length})
            </p>
            <div className="space-y-0.5">
              {routes.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-800/50 group"
                >
                  <button
                    onClick={() => r.waypoints[0] && onCenterOn(r.waypoints[0].x, r.waypoints[0].z)}
                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2" className="shrink-0">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-medium text-zinc-300 truncate">{r.name}</p>
                      <p className="text-[9px] text-zinc-600">{r.waypoints.length} pts {r.loop ? '(loop)' : ''}</p>
                    </div>
                  </button>
                  <button
                    onClick={() => handleDeleteRoute(r.id)}
                    className="text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-[10px]"
                  >
                    x
                  </button>
                </div>
              ))}
              {routes.length === 0 && <p className="text-[11px] text-zinc-600 text-center py-4">No routes</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
