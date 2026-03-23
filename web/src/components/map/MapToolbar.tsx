'use client';

import { ShowState } from './mapDrawing';

function ToggleBtn({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded transition-colors ${active ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:text-zinc-400'}`}
      style={active && color ? { color } : undefined}
    >{label}</button>
  );
}

interface MapToolbarProps {
  show: ShowState;
  toggleShow: (key: keyof ShowState) => void;
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  terrainStatus: 'idle' | 'loading' | 'loaded' | 'error';
  onReloadTerrain: () => void;
}

export function MapToolbar({
  show,
  toggleShow,
  scale,
  onZoomIn,
  onZoomOut,
  terrainStatus,
  onReloadTerrain,
}: MapToolbarProps) {
  return (
    <div className="px-4 py-2.5 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-950/80 backdrop-blur-sm shrink-0">
      <div className="flex items-center gap-4">
        <h1 className="text-sm font-bold text-white">World Map</h1>
        <div className="flex items-center gap-1.5 text-[11px]">
          <ToggleBtn active={show.terrain} onClick={() => toggleShow('terrain')} label="Terrain" color="#5B8C33" />
          <ToggleBtn active={show.grid} onClick={() => toggleShow('grid')} label="Grid" />
          <ToggleBtn active={show.trails} onClick={() => toggleShow('trails')} label="Trails" />
          <ToggleBtn active={show.coords} onClick={() => toggleShow('coords')} label="Coords" />
          <span className="w-px h-4 bg-zinc-800 mx-1" />
          <ToggleBtn active={show.bots} onClick={() => toggleShow('bots')} label="Bots" color="#10B981" />
          <ToggleBtn active={show.players} onClick={() => toggleShow('players')} label="Players" color="#60A5FA" />
        </div>
        {terrainStatus === 'loading' && (
          <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <span className="w-3 h-3 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
            Loading terrain...
          </span>
        )}
        {terrainStatus === 'error' && <span className="text-[10px] text-red-400/70">Terrain unavailable</span>}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onReloadTerrain}
          className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-xs transition-colors"
          title="Reload terrain"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
        <span className="w-px h-4 bg-zinc-800" />
        <button
          onClick={onZoomIn}
          className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors"
        >+</button>
        <span className="text-[10px] text-zinc-500 font-mono w-8 text-center">{scale.toFixed(1)}x</span>
        <button
          onClick={onZoomOut}
          className="w-7 h-7 flex items-center justify-center rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm transition-colors"
        >-</button>
      </div>
    </div>
  );
}
