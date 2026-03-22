'use client';

import { motion } from 'framer-motion';
import { formatItemName } from '@/lib/items';

interface BotStatsData {
  mined: Record<string, number>;
  crafted: Record<string, number>;
  smelted: Record<string, number>;
  placed: Record<string, number>;
  killed: Record<string, number>;
  deaths: number;
  interrupts: number;
  movementTimeouts: number;
  damageTaken: number;
}

interface Props {
  stats: BotStatsData;
}

function sumValues(obj: Record<string, number>): number {
  return Object.values(obj).reduce((a, b) => a + b, 0);
}

function topEntries(obj: Record<string, number>, count = 5): [string, number][] {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, count);
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
      <p className="text-lg font-bold tabular-nums" style={{ color }}>{value}</p>
      <p className="text-[10px] text-zinc-500 mt-0.5">{label}</p>
    </div>
  );
}

function StatBars({ title, entries, color }: { title: string; entries: [string, number][]; color: string }) {
  if (entries.length === 0) return null;
  const max = Math.max(1, entries[0][1]);

  return (
    <div>
      <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-2">{title}</p>
      <div className="space-y-1.5">
        {entries.map(([name, count], i) => (
          <div key={name} className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-400 w-20 truncate text-right" title={formatItemName(name)}>
              {formatItemName(name)}
            </span>
            <div className="flex-1 h-4 bg-zinc-800 rounded overflow-hidden">
              <motion.div
                className="h-full rounded flex items-center px-1.5"
                style={{ backgroundColor: `${color}25` }}
                initial={{ width: 0 }}
                animate={{ width: `${(count / max) * 100}%` }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
              >
                <span className="text-[9px] font-bold tabular-nums" style={{ color }}>{count}</span>
              </motion.div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsPanel({ stats }: Props) {
  const totalMined = sumValues(stats.mined);
  const totalCrafted = sumValues(stats.crafted);
  const totalKills = sumValues(stats.killed);
  const hasAnyStats = totalMined > 0 || totalCrafted > 0 || totalKills > 0 || stats.deaths > 0;

  if (!hasAnyStats) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
      >
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Stats</h2>
        <p className="text-xs text-zinc-600 text-center py-3">No stats recorded yet</p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 space-y-4"
    >
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Stats</h2>

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-2">
        <StatCard label="Deaths" value={stats.deaths} color="#EF4444" />
        <StatCard label="Damage" value={Math.round(stats.damageTaken)} color="#F59E0B" />
        <StatCard label="Mined" value={totalMined} color="#60A5FA" />
        <StatCard label="Crafted" value={totalCrafted} color="#10B981" />
      </div>

      {/* Top mined */}
      <StatBars title="Top Mined" entries={topEntries(stats.mined)} color="#60A5FA" />

      {/* Top crafted */}
      <StatBars title="Top Crafted" entries={topEntries(stats.crafted)} color="#10B981" />

      {/* Kills */}
      <StatBars title="Kills" entries={topEntries(stats.killed)} color="#EF4444" />
    </motion.div>
  );
}
