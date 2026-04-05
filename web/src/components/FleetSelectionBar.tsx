'use client';

import { CommandButtonGroup } from '@/components/CommandButtonGroup';

interface FleetSelectionBarProps {
  selectedBotNames: string[];
  onClearSelection: () => void;
}

/**
 * Floating action bar shown when one or more bots are selected in the fleet view.
 * Provides bulk command buttons via CommandButtonGroup.
 */
export function FleetSelectionBar({ selectedBotNames, onClearSelection }: FleetSelectionBarProps) {
  if (selectedBotNames.length === 0) return null;

  return (
    <div className="sticky bottom-4 z-30 mx-auto max-w-3xl">
      <div className="bg-zinc-900/95 backdrop-blur-md border border-zinc-700/60 rounded-xl px-4 py-3 shadow-2xl flex items-center gap-4 flex-wrap">
        {/* Selection count */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-medium text-zinc-300">
            {selectedBotNames.length} bot{selectedBotNames.length !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={onClearSelection}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors underline"
          >
            Clear
          </button>
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-zinc-700/60 shrink-0" />

        {/* Command buttons */}
        <CommandButtonGroup
          targetBotNames={selectedBotNames}
          variant="compact"
        />
      </div>
    </div>
  );
}
