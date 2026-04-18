'use client';

import { useMapOverlayStore, type MapTool } from '@/lib/mapStore';

const tools: { id: MapTool; label: string; icon: string; title: string }[] = [
  { id: 'select', label: 'Select', icon: 'cursor', title: 'Select / Pan (default)' },
  { id: 'draw-zone', label: 'Zone', icon: 'zone', title: 'Draw a zone rectangle' },
  { id: 'draw-route', label: 'Route', icon: 'route', title: 'Draw a patrol route' },
  { id: 'place-marker', label: 'Marker', icon: 'marker', title: 'Place a world marker' },
  { id: 'place-building', label: 'Building', icon: 'building', title: 'Place a schematic footprint on the map' },
];

export function MapToolbar() {
  const activeTool = useMapOverlayStore((s) => s.activeTool);
  const setActiveTool = useMapOverlayStore((s) => s.setActiveTool);

  return (
    <div className="flex items-center gap-1">
      {tools.map((tool) => (
        <button
          key={tool.id}
          onClick={() => setActiveTool(tool.id === activeTool ? 'select' : tool.id)}
          title={tool.title}
          className={`px-2 py-1 rounded text-[11px] font-medium transition-all border ${
            activeTool === tool.id
              ? 'bg-violet-600/20 border-violet-500/40 text-violet-300'
              : 'bg-zinc-800/50 border-zinc-700/30 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
          }`}
        >
          <ToolIcon type={tool.icon} active={activeTool === tool.id} />
          <span className="ml-1">{tool.label}</span>
        </button>
      ))}
    </div>
  );
}

function ToolIcon({ type, active }: { type: string; active: boolean }) {
  const color = active ? 'currentColor' : 'currentColor';
  switch (type) {
    case 'cursor':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
        </svg>
      );
    case 'zone':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block">
          <rect x="3" y="3" width="18" height="18" rx="2" />
        </svg>
      );
    case 'route':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case 'marker':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      );
    case 'building':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="inline-block">
          <rect x="4" y="2" width="16" height="20" rx="1" />
          <path d="M9 22V12h6v10" />
          <path d="M8 6h2" />
          <path d="M14 6h2" />
          <path d="M8 10h2" />
          <path d="M14 10h2" />
        </svg>
      );
    default:
      return null;
  }
}
