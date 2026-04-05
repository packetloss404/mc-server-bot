'use client';

import { useEffect, useRef } from 'react';

export interface MapContextMenuAction {
  label: string;
  icon?: string;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  worldX: number;
  worldZ: number;
  actions: MapContextMenuAction[];
  onClose: () => void;
}

export function MapContextMenu({ x, y, worldX, worldZ, actions, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-zinc-900 border border-zinc-700/60 rounded-lg shadow-xl py-1 min-w-[180px]"
      style={{ left: x, top: y }}
    >
      <div className="px-3 py-1.5 border-b border-zinc-800/60">
        <p className="text-[10px] text-zinc-500 font-mono">
          {Math.round(worldX)}, {Math.round(worldZ)}
        </p>
      </div>
      {actions.map((action, i) => (
        <button
          key={i}
          onClick={() => { action.onClick(); onClose(); }}
          className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
            action.danger
              ? 'text-red-400 hover:bg-red-400/10'
              : 'text-zinc-300 hover:bg-zinc-800'
          }`}
        >
          {action.icon && <span className="w-4 text-center text-[10px]">{action.icon}</span>}
          {action.label}
        </button>
      ))}
    </div>
  );
}
