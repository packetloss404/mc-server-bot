'use client';

import { MapEntity } from './mapDrawing';

interface MapEntitySidebarProps {
  entities: MapEntity[];
  selectedEntity: string | null;
  onSelect: (entity: MapEntity) => void;
}

export function MapEntitySidebar({ entities, selectedEntity, onSelect }: MapEntitySidebarProps) {
  return (
    <div className="w-52 border-r border-zinc-800/60 bg-zinc-950/50 overflow-y-auto shrink-0">
      <div className="p-3">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Entities ({entities.length})
        </p>
        <div className="space-y-0.5">
          {entities.map((entity) => (
            <button
              key={`${entity.type}-${entity.name}`}
              onClick={() => onSelect(entity)}
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
      </div>
    </div>
  );
}
