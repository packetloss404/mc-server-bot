'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useBotStore } from '@/lib/store';
import { STATE_COLORS, STATE_LABELS, PERSONALITY_ICONS, getPersonalityColor } from '@/lib/constants';
import { CommandButtonGroup } from '@/components/CommandButtonGroup';
import { FleetSelectionBar } from '@/components/FleetSelectionBar';

export default function FleetPage() {
  const bots = useBotStore((s) => s.botList);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleBot = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(bots.map((b) => b.name)));
  };

  const clearSelection = () => {
    setSelected(new Set());
  };

  const selectedNames = Array.from(selected);

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Fleet Control</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Select bots to issue bulk commands
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={selectAll}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors px-2 py-1 rounded-md hover:bg-zinc-800/60"
          >
            Select All
          </button>
          {selected.size > 0 && (
            <button
              onClick={clearSelection}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded-md hover:bg-zinc-800/60"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Bot list */}
      <div className="space-y-2">
        {bots.length === 0 && (
          <div className="text-center py-12">
            <p className="text-sm text-zinc-500">No bots online</p>
            <Link href="/manage" className="text-xs text-zinc-600 hover:text-zinc-400 mt-2 inline-block">
              Go to Manage to spawn bots
            </Link>
          </div>
        )}
        {bots.map((bot) => {
          const isSelected = selected.has(bot.name);
          const stateColor = STATE_COLORS[bot.state] ?? '#6B7280';
          const accentColor = getPersonalityColor(bot.personality);
          const emoji = PERSONALITY_ICONS[bot.personality?.toLowerCase()] ?? '';

          return (
            <motion.div
              key={bot.name}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-zinc-900/80 border rounded-xl p-4 flex items-center gap-4 transition-colors cursor-pointer ${
                isSelected
                  ? 'border-emerald-500/40 bg-emerald-500/[0.03]'
                  : 'border-zinc-800/60 hover:border-zinc-700/60'
              }`}
              onClick={() => toggleBot(bot.name)}
            >
              {/* Checkbox */}
              <div
                className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                  isSelected
                    ? 'border-emerald-500 bg-emerald-500/20'
                    : 'border-zinc-700 bg-zinc-800/60'
                }`}
              >
                {isSelected && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </div>

              {/* Bot info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{emoji}</span>
                  <Link
                    href={`/bots/${bot.name}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-sm font-medium text-white hover:underline"
                  >
                    {bot.name}
                  </Link>
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded uppercase"
                    style={{ color: stateColor, backgroundColor: `${stateColor}12` }}
                  >
                    {STATE_LABELS[bot.state] ?? bot.state}
                  </span>
                </div>
                <p className="text-[10px] mt-0.5" style={{ color: accentColor }}>
                  {bot.personality} &middot; {bot.mode}
                </p>
              </div>

              {/* Per-bot quick commands */}
              <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
                <CommandButtonGroup
                  targetBotNames={[bot.name]}
                  variant="compact"
                  disabled={bot.state === 'DISCONNECTED'}
                />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Fleet selection bar */}
      <FleetSelectionBar
        selectedBotNames={selectedNames}
        onClearSelection={clearSelection}
      />
    </div>
  );
}
