'use client';

import type { MapMode } from './mapDrawing';

interface MapToolbarProps {
  mode: MapMode;
  onModeChange: (mode: MapMode) => void;
  routeWaypointCount: number;
  onUndoWaypoint: () => void;
  onFinishRoute: () => void;
  onCancelRoute: () => void;
}

export function MapToolbar({
  mode,
  onModeChange,
  routeWaypointCount,
  onUndoWaypoint,
  onFinishRoute,
  onCancelRoute,
}: MapToolbarProps) {
  const isDrawing = mode === 'draw-route';

  return (
    <div className="flex items-center gap-1.5">
      {/* Navigate tool */}
      <ToolButton
        active={mode === 'navigate'}
        onClick={() => {
          if (isDrawing) onCancelRoute();
          onModeChange('navigate');
        }}
        title="Navigate (pan & select)"
        label={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 9l4-4 4 4" />
            <path d="M9 5v14" />
            <path d="M19 15l-4 4-4-4" />
            <path d="M15 19V5" />
          </svg>
        }
      />

      <span className="w-px h-4 bg-zinc-800" />

      {/* Route drawing tool */}
      <ToolButton
        active={isDrawing}
        onClick={() => onModeChange(isDrawing ? 'navigate' : 'draw-route')}
        title="Draw Route (click to place waypoints)"
        color="#F59E0B"
        label={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="6" r="2" />
            <circle cx="18" cy="18" r="2" />
            <path d="M6 8v4c0 2 2 4 4 4h4" />
            <polyline points="15 13 18 16 15 19" />
          </svg>
        }
      />

      {/* Route drawing controls (shown while drawing) */}
      {isDrawing && (
        <>
          <span className="w-px h-4 bg-zinc-800 mx-0.5" />
          <span className="text-[10px] text-amber-400/80 font-mono tabular-nums px-1">
            {routeWaypointCount} pt{routeWaypointCount !== 1 ? 's' : ''}
          </span>
          <button
            onClick={onUndoWaypoint}
            disabled={routeWaypointCount === 0}
            className="px-2 py-0.5 rounded text-[11px] transition-colors bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Undo last waypoint (Ctrl+Z)"
          >
            Undo
          </button>
          <button
            onClick={onFinishRoute}
            disabled={routeWaypointCount < 2}
            className="px-2 py-0.5 rounded text-[11px] transition-colors bg-amber-600/80 hover:bg-amber-600 text-white disabled:opacity-30 disabled:cursor-not-allowed"
            title="Finish route (Enter)"
          >
            Finish
          </button>
          <button
            onClick={onCancelRoute}
            className="px-2 py-0.5 rounded text-[11px] transition-colors bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
            title="Cancel route (Escape)"
          >
            Cancel
          </button>
        </>
      )}
    </div>
  );
}

// ── Overlay toggle types and buttons ──

export interface OverlayToggles {
  missions: boolean;
  squads: boolean;
}

export function OverlayToggleButtons({
  toggles,
  onToggle,
}: {
  toggles: OverlayToggles;
  onToggle: (key: keyof OverlayToggles) => void;
}) {
  return (
    <>
      <span className="w-px h-4 bg-zinc-800 mx-1" />
      <OverlayBtn
        active={toggles.missions}
        onClick={() => onToggle('missions')}
        label="Missions"
        color="#10B981"
      />
      <OverlayBtn
        active={toggles.squads}
        onClick={() => onToggle('squads')}
        label="Squads"
        color="#8B5CF6"
      />
    </>
  );
}

function OverlayBtn({
  active,
  onClick,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded transition-colors ${
        active ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-600 hover:text-zinc-400'
      }`}
      style={active && color ? { color } : undefined}
    >
      {label}
    </button>
  );
}

function ToolButton({
  active,
  onClick,
  title,
  label,
  color,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  label: React.ReactNode;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
        active
          ? 'bg-zinc-700 text-white ring-1 ring-zinc-600'
          : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400'
      }`}
      style={active && color ? { color } : undefined}
    >
      {label}
    </button>
  );
}
