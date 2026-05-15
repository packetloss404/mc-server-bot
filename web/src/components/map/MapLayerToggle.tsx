'use client';

import { useState } from 'react';

export type LayerKey =
  | 'bots'
  | 'players'
  | 'markers'
  | 'zones'
  | 'routes'
  | 'builds'
  | 'trails'
  | 'heightmap'
  | 'biome';

export type LayerState = Record<LayerKey, boolean>;

export const DEFAULT_LAYERS: LayerState = {
  bots: true,
  players: true,
  markers: true,
  zones: true,
  routes: true,
  builds: true,
  trails: true,
  heightmap: false,
  biome: false,
};

export const LAYER_KEYS: LayerKey[] = [
  'bots',
  'players',
  'markers',
  'zones',
  'routes',
  'builds',
  'trails',
  'heightmap',
  'biome',
];

const LAYER_LABELS: Record<LayerKey, string> = {
  bots: 'Bots',
  players: 'Players',
  markers: 'Markers',
  zones: 'Zones',
  routes: 'Routes',
  builds: 'Builds',
  trails: 'Movement Trails',
  heightmap: 'Heightmap',
  biome: 'Biome tint',
};

const LAYER_COLORS: Partial<Record<LayerKey, string>> = {
  bots: '#10B981',
  players: '#60A5FA',
  markers: '#FFFFFF',
  zones: '#8B5CF6',
  routes: '#F59E0B',
  builds: '#F59E0B',
  trails: '#22D3EE',
};

const DEFERRED: LayerKey[] = ['heightmap', 'biome'];

interface Props {
  layers: LayerState;
  onChange: (next: LayerState) => void;
}

export function MapLayerToggle({ layers, onChange }: Props) {
  const [open, setOpen] = useState(true);

  const toggle = (key: LayerKey) => {
    onChange({ ...layers, [key]: !layers[key] });
  };

  return (
    <div
      className="absolute top-3 right-3 z-30 bg-zinc-900/95 border border-zinc-700/60 rounded-lg shadow-xl backdrop-blur-sm text-[11px] select-none"
      style={{ minWidth: 168 }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-1.5 border-b border-zinc-800/60 text-zinc-300 hover:text-white"
      >
        <span className="font-semibold uppercase tracking-wider text-[10px] text-zinc-400">
          Layers
        </span>
        <span className="text-zinc-500 font-mono text-[10px]">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="py-1">
          {LAYER_KEYS.map((key) => {
            const deferred = DEFERRED.includes(key);
            const checked = layers[key];
            return (
              <li key={key}>
                <label
                  className={`flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-zinc-800/60 ${
                    deferred ? 'opacity-50' : ''
                  }`}
                  title={deferred ? 'Deferred (costly)' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={deferred}
                    onChange={() => !deferred && toggle(key)}
                    className="w-3 h-3 accent-teal-500"
                  />
                  {LAYER_COLORS[key] && (
                    <span
                      className="w-2 h-2 rounded-sm shrink-0"
                      style={{ backgroundColor: LAYER_COLORS[key] }}
                    />
                  )}
                  <span className="text-zinc-300">{LAYER_LABELS[key]}</span>
                  {deferred && (
                    <span className="ml-auto text-[9px] text-zinc-600 uppercase">soon</span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Hash <-> LayerState helpers ──────────────────────────────────────────

export function encodeLayers(layers: LayerState): string {
  return LAYER_KEYS.filter((k) => layers[k]).join(',');
}

export function decodeLayers(value: string | undefined): LayerState | null {
  if (!value) return null;
  const enabled = new Set(
    value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
  const next = { ...DEFAULT_LAYERS };
  // Anything not listed becomes false; anything listed becomes true (if a known key).
  for (const key of LAYER_KEYS) {
    next[key] = enabled.has(key);
  }
  return next;
}
