'use client';

import { useEffect, useRef } from 'react';

export type ContextMenuTarget =
  | { kind: 'canvas'; worldX: number; worldZ: number }
  | { kind: 'bot'; name: string; worldX: number; worldZ: number }
  | { kind: 'zone'; zoneId: string; zoneName: string; zoneType: string }
  | { kind: 'marker'; markerId: string; markerName: string; worldX: number; worldZ: number }
  | { kind: 'route'; routeId: string; routeName: string };

export interface ContextMenuAction {
  label: string;
  icon: string;
  color?: string;
  disabled?: boolean;
  onClick: () => void;
}

interface Props {
  x: number;
  y: number;
  target: ContextMenuTarget;
  selectedBotCount: number;
  actions: ContextMenuAction[];
  onClose: () => void;
}

export function MapContextMenu({ x, y, target, selectedBotCount, actions, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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

  // Adjust position so menu stays on screen
  const style: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 100,
  };

  const headerText = (() => {
    switch (target.kind) {
      case 'canvas':
        return `${Math.round(target.worldX)}, ${Math.round(target.worldZ)}`;
      case 'bot':
        return target.name;
      case 'zone':
        return target.zoneName;
      case 'marker':
        return target.markerName;
      case 'route':
        return target.routeName;
    }
  })();

  const headerIcon = (() => {
    switch (target.kind) {
      case 'canvas': return 'crosshair';
      case 'bot': return 'bot';
      case 'zone': return 'zone';
      case 'marker': return 'marker';
      case 'route': return 'route';
    }
  })();

  return (
    <div ref={menuRef} style={style}>
      <div className="bg-zinc-900/95 backdrop-blur-md border border-zinc-700/60 rounded-lg shadow-xl min-w-[200px] overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2 border-b border-zinc-800/60 flex items-center gap-2">
          <TargetIcon type={headerIcon} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-zinc-200 truncate">{headerText}</p>
            {target.kind === 'canvas' && selectedBotCount > 0 && (
              <p className="text-[9px] text-zinc-500">{selectedBotCount} bot{selectedBotCount !== 1 ? 's' : ''} selected</p>
            )}
            {target.kind === 'bot' && (
              <p className="text-[9px] text-zinc-500">
                {Math.round(target.worldX)}, {Math.round(target.worldZ)}
              </p>
            )}
            {target.kind === 'zone' && (
              <p className="text-[9px] text-zinc-500 capitalize">{target.zoneType} zone</p>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="py-1">
          {actions.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-zinc-600">No actions available</p>
          )}
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={() => { action.onClick(); onClose(); }}
              disabled={action.disabled}
              className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[11px] transition-colors ${
                action.disabled
                  ? 'text-zinc-600 cursor-not-allowed'
                  : 'text-zinc-300 hover:bg-zinc-800/80 hover:text-white'
              }`}
            >
              <span
                className="w-4 text-center text-[10px] shrink-0"
                style={action.color ? { color: action.color } : undefined}
              >
                {action.icon}
              </span>
              <span className="flex-1">{action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function TargetIcon({ type }: { type: string }) {
  const cls = 'w-4 h-4 shrink-0';
  switch (type) {
    case 'crosshair':
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="#9CA3AF" strokeWidth="1.5">
          <circle cx="8" cy="8" r="5" />
          <line x1="8" y1="1" x2="8" y2="4" />
          <line x1="8" y1="12" x2="8" y2="15" />
          <line x1="1" y1="8" x2="4" y2="8" />
          <line x1="12" y1="8" x2="15" y2="8" />
        </svg>
      );
    case 'bot':
      return <span className={`${cls} flex items-center justify-center text-[10px] text-emerald-400`}>B</span>;
    case 'zone':
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="#60A5FA" strokeWidth="1.5">
          <rect x="2" y="2" width="12" height="12" rx="1" strokeDasharray="3 2" />
        </svg>
      );
    case 'marker':
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="#F59E0B" strokeWidth="1.5">
          <path d="M8 1C5.2 1 3 3.2 3 6c0 4 5 9 5 9s5-5 5-9c0-2.8-2.2-5-5-5z" />
          <circle cx="8" cy="6" r="1.5" fill="#F59E0B" />
        </svg>
      );
    case 'route':
      return (
        <svg className={cls} viewBox="0 0 16 16" fill="none" stroke="#A78BFA" strokeWidth="1.5">
          <polyline points="2,12 6,4 10,10 14,3" />
          <circle cx="2" cy="12" r="1.5" fill="#A78BFA" />
          <circle cx="14" cy="3" r="1.5" fill="#A78BFA" />
        </svg>
      );
    default:
      return null;
  }
}
