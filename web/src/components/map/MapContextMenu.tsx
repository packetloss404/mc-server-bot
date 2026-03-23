'use client';

import { useEffect, useRef } from 'react';
import type { MarkerRecord } from '@/lib/api';

export type ContextTarget =
  | { type: 'terrain'; worldX: number; worldZ: number }
  | { type: 'bot'; name: string; worldX: number; worldZ: number }
  | { type: 'player'; name: string; worldX: number; worldZ: number }
  | { type: 'marker'; marker: MarkerRecord };

interface MapContextMenuProps {
  target: ContextTarget;
  screenX: number;
  screenY: number;
  selectedBot: string | null;
  onClose: () => void;
  onWalkHere: (x: number, z: number) => void;
  onCreateMarker: (x: number, z: number) => void;
  onCopyCoords: (x: number, z: number) => void;
  onFollow: (targetName: string) => void;
  onEditMarker: (marker: MarkerRecord) => void;
  onDeleteMarker: (marker: MarkerRecord) => void;
}

export default function MapContextMenu({
  target,
  screenX,
  screenY,
  selectedBot,
  onClose,
  onWalkHere,
  onCreateMarker,
  onCopyCoords,
  onFollow,
  onEditMarker,
  onDeleteMarker,
}: MapContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // Adjust position to stay within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: screenX,
    top: screenY,
    zIndex: 50,
  };

  const items: { label: string; onClick: () => void; disabled?: boolean }[] = [];

  if (target.type === 'terrain') {
    items.push({
      label: `Walk Here${selectedBot ? '' : ' (select bot)'}`,
      onClick: () => { onWalkHere(target.worldX, target.worldZ); onClose(); },
      disabled: !selectedBot,
    });
    items.push({
      label: 'Create Marker',
      onClick: () => { onCreateMarker(target.worldX, target.worldZ); onClose(); },
    });
    items.push({
      label: 'Copy Coordinates',
      onClick: () => { onCopyCoords(target.worldX, target.worldZ); onClose(); },
    });
  } else if (target.type === 'bot' || target.type === 'player') {
    items.push({
      label: `Follow ${target.name}${selectedBot ? '' : ' (select bot)'}`,
      onClick: () => { onFollow(target.name); onClose(); },
      disabled: !selectedBot,
    });
    items.push({
      label: `Walk To ${target.name}${selectedBot ? '' : ' (select bot)'}`,
      onClick: () => { onWalkHere(target.worldX, target.worldZ); onClose(); },
      disabled: !selectedBot,
    });
    items.push({
      label: 'Copy Coordinates',
      onClick: () => { onCopyCoords(target.worldX, target.worldZ); onClose(); },
    });
  } else if (target.type === 'marker') {
    items.push({
      label: `Move Here${selectedBot ? '' : ' (select bot)'}`,
      onClick: () => { onWalkHere(target.marker.position.x, target.marker.position.z); onClose(); },
      disabled: !selectedBot,
    });
    items.push({
      label: 'Edit Marker',
      onClick: () => { onEditMarker(target.marker); onClose(); },
    });
    items.push({
      label: 'Delete Marker',
      onClick: () => { onDeleteMarker(target.marker); onClose(); },
    });
  }

  return (
    <div ref={menuRef} style={style}>
      <div className="bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl py-1 min-w-[180px] text-[12px]">
        {/* Header */}
        <div className="px-3 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-800/60">
          {target.type === 'terrain' && `${Math.round(target.worldX)}, ${Math.round(target.worldZ)}`}
          {target.type === 'bot' && `Bot: ${target.name}`}
          {target.type === 'player' && `Player: ${target.name}`}
          {target.type === 'marker' && `Marker: ${target.marker.name}`}
        </div>
        {items.map((item, i) => (
          <button
            key={i}
            onClick={item.onClick}
            disabled={item.disabled}
            className={`w-full text-left px-3 py-1.5 transition-colors ${
              item.disabled
                ? 'text-zinc-600 cursor-not-allowed'
                : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
