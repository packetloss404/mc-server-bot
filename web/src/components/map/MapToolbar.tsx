'use client';

/**
 * Overlay toggle buttons for the map toolbar.
 * These are rendered inline within the existing toolbar in map/page.tsx.
 */

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
