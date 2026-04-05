'use client';

import Link from 'next/link';
import { useBotStore, useControlStore } from '@/lib/store';
import { getPersonalityColor, PERSONALITY_ICONS } from '@/lib/constants';

export function FleetSelectionBar() {
  const selectedBotIds = useControlStore((s) => s.selectedBotIds);
  const clearSelection = useControlStore((s) => s.clearSelection);
  const deselectBot = useControlStore((s) => s.deselectBot);
  const bots = useBotStore((s) => s.botList);

  const selectedBots = bots.filter((b) => selectedBotIds.has(b.name.toLowerCase()));
  const count = selectedBots.length;

  if (count === 0) return null;

  return (
    <div className="flex items-center gap-3 bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-4 py-2.5">
      {/* Count & label */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-bold">
          {count}
        </span>
        <span className="text-xs font-medium text-emerald-300">
          bot{count !== 1 ? 's' : ''} selected
        </span>
      </div>

      {/* Selected bot chips */}
      <div className="flex items-center gap-1.5 flex-1 overflow-x-auto">
        {selectedBots.map((bot) => {
          const color = getPersonalityColor(bot.personality);
          const emoji = PERSONALITY_ICONS[bot.personality?.toLowerCase()] ?? '';
          return (
            <span
              key={bot.name}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-200 bg-zinc-800/80 border border-zinc-700/50 rounded-lg pl-2 pr-1 py-1 shrink-0"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: color }}
              />
              {emoji && <span className="text-[10px]">{emoji}</span>}
              {bot.name}
              <button
                onClick={() => deselectBot(bot.name)}
                className="ml-0.5 w-4 h-4 rounded flex items-center justify-center text-zinc-500 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
                title={`Deselect ${bot.name}`}
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </span>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Link
          href="/fleet"
          className="text-[11px] font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1 rounded-md transition-colors"
        >
          Fleet View
        </Link>
        <button
          onClick={clearSelection}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded-md hover:bg-zinc-800 transition-colors"
        >
          Clear All
        </button>
      </div>
    </div>
  );
}
