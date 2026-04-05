'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useBotStore, useControlStore, type BotLiveData } from '@/lib/store';
import { BotCard } from '@/components/BotCard';
import { FleetSelectionBar } from '@/components/FleetSelectionBar';
import { getPersonalityColor, STATE_COLORS, STATE_LABELS } from '@/lib/constants';

export default function FleetPage() {
  const bots = useBotStore((s) => s.botList);
  const selectedBotIds = useControlStore((s) => s.selectedBotIds);
  const toggleBotSelection = useControlStore((s) => s.toggleBotSelection);
  const clearSelection = useControlStore((s) => s.clearSelection);
  const setSelection = useControlStore((s) => s.setSelection);

  const selectedBots = bots.filter((b) => selectedBotIds.has(b.name.toLowerCase()));
  const unselectedBots = bots.filter((b) => !selectedBotIds.has(b.name.toLowerCase()));
  const selectionCount = selectedBots.length;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1400px]">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-lg font-bold text-white">Fleet Management</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Select bots from here, the dashboard, or the map -- selections are shared everywhere.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {bots.length > 0 && selectionCount < bots.length && (
            <button
              onClick={() => setSelection(bots.map((b) => b.name))}
              className="text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors border border-zinc-700/50"
            >
              Select All ({bots.length})
            </button>
          )}
          {selectionCount > 0 && (
            <button
              onClick={clearSelection}
              className="text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 px-3 py-1.5 rounded-lg transition-colors border border-zinc-700/50"
            >
              Clear Selection
            </button>
          )}
        </div>
      </motion.div>

      {/* Fleet Selection Bar */}
      <FleetSelectionBar />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FleetStat label="Total Bots" value={bots.length} color="#6B7280" />
        <FleetStat label="Selected" value={selectionCount} color="#10B981" />
        <FleetStat
          label="Active (Selected)"
          value={selectedBots.filter((b) => !['IDLE', 'DISCONNECTED'].includes(b.state)).length}
          color="#F59E0B"
        />
        <FleetStat
          label="Idle (Selected)"
          value={selectedBots.filter((b) => b.state === 'IDLE').length}
          color="#6B7280"
        />
      </div>

      {/* Selected Bots */}
      {selectionCount > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider mb-4">
            Selected Bots ({selectionCount})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {selectedBots.map((bot, i) => (
              <BotCard key={bot.name} bot={bot} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Unselected Bots */}
      {unselectedBots.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">
            {selectionCount > 0 ? 'Other Bots' : 'All Bots'} ({unselectedBots.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {unselectedBots.map((bot, i) => (
              <BotCard key={bot.name} bot={bot} index={i} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {bots.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40"
        >
          <p className="text-sm text-zinc-500">No bots online</p>
          <p className="text-xs text-zinc-600 mt-1">
            <Link href="/manage" className="text-emerald-500 hover:text-emerald-400">Create a bot</Link> to get started
          </p>
        </motion.div>
      )}
    </div>
  );
}

function FleetStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
      <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
    </div>
  );
}
