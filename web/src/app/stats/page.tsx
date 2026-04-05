'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useBotStore } from '@/lib/store';
import { api } from '@/lib/api';
import { getPersonalityColor, PERSONALITY_ICONS } from '@/lib/constants';
import { PageHeader } from '@/components/PageHeader';

interface BotStats {
  name: string;
  personality: string;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
  relationships: number;
}

export default function StatsPage() {
  const bots = useBotStore((s) => s.botList);
  const [stats, setStats] = useState<BotStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'completed' | 'rate' | 'relationships'>('completed');

  useEffect(() => {
    const loadStats = async () => {
      setLoading(true);
      const results = await Promise.all(
        bots.map(async (bot) => {
          try {
            const [tasks, rels] = await Promise.all([
              api.getBotTasks(bot.name),
              api.getBotRelationships(bot.name),
            ]);
            const total = tasks.completedTasks.length + tasks.failedTasks.length;
            return {
              name: bot.name,
              personality: bot.personality,
              completedTasks: tasks.completedTasks.length,
              failedTasks: tasks.failedTasks.length,
              successRate: total > 0 ? Math.round((tasks.completedTasks.length / total) * 100) : 0,
              relationships: Object.keys(rels.relationships).length,
            } as BotStats;
          } catch {
            return null;
          }
        }),
      );
      setStats(results.filter((r): r is BotStats => r !== null));
      setLoading(false);
    };
    loadStats();
  }, [bots]);

  const sorted = [...stats].sort((a, b) => {
    if (sortBy === 'completed') return b.completedTasks - a.completedTasks;
    if (sortBy === 'rate') return b.successRate - a.successRate;
    return b.relationships - a.relationships;
  });

  const maxCompleted = Math.max(1, ...stats.map((s) => s.completedTasks));
  const totalCompleted = stats.reduce((sum, s) => sum + s.completedTasks, 0);
  const totalFailed = stats.reduce((sum, s) => sum + s.failedTasks, 0);
  const avgRate = stats.length > 0 ? Math.round(stats.reduce((sum, s) => sum + s.successRate, 0) / stats.length) : 0;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl">
      <PageHeader title="Stats & Leaderboards" subtitle={`${stats.length} bots tracked`} />

      {loading ? (
        <div className="py-16 text-center">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-zinc-500">Loading stats...</p>
        </div>
      ) : stats.length === 0 ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40">
          <p className="text-sm text-zinc-500">No stats available</p>
          <p className="text-xs text-zinc-600 mt-1">Stats appear when bots start completing tasks</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-3 gap-3">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
            >
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Total Completed</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{totalCompleted}</p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
            >
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Total Failed</p>
              <p className="text-2xl font-bold text-red-400 mt-1">{totalFailed}</p>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
            >
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Avg Success Rate</p>
              <p className="text-2xl font-bold text-white mt-1">{avgRate}%</p>
            </motion.div>
          </div>

          {/* Leaderboard */}
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-semibold text-zinc-300">Tasks Completed</h2>
              <div className="flex gap-1">
                {([['completed', 'Tasks'], ['rate', 'Rate'], ['relationships', 'Social']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setSortBy(key)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                      sortBy === key ? 'bg-zinc-700 text-white' : 'text-zinc-600 hover:text-zinc-400'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {sorted.map((s, i) => {
                const pct = (s.completedTasks / maxCompleted) * 100;
                const color = getPersonalityColor(s.personality);
                const emoji = PERSONALITY_ICONS[s.personality?.toLowerCase()] ?? '';
                return (
                  <motion.div
                    key={s.name}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-3"
                  >
                    <span className="text-xs text-zinc-600 w-5 text-right font-mono">{i + 1}</span>
                    <span className="text-sm w-4">{emoji}</span>
                    <span className="text-xs font-medium w-28 truncate" style={{ color }}>{s.name}</span>
                    <div className="flex-1 h-6 bg-zinc-800 rounded-lg overflow-hidden">
                      <motion.div
                        className="h-full rounded-lg flex items-center px-2.5"
                        style={{ backgroundColor: `${color}30` }}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(pct, 8)}%` }}
                        transition={{ duration: 0.5, delay: i * 0.05 }}
                      >
                        <span className="text-[11px] font-bold" style={{ color }}>{s.completedTasks}</span>
                      </motion.div>
                    </div>
                    <span className="text-[10px] text-zinc-500 w-12 text-right">{s.successRate}%</span>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Detailed Table */}
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800/60 text-zinc-500 text-xs">
                  <th className="text-left px-5 py-3 font-medium">#</th>
                  <th className="text-left px-5 py-3 font-medium">Bot</th>
                  <th className="text-right px-5 py-3 font-medium">Completed</th>
                  <th className="text-right px-5 py-3 font-medium">Failed</th>
                  <th className="text-right px-5 py-3 font-medium">Success %</th>
                  <th className="text-right px-5 py-3 font-medium">Relationships</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s, i) => (
                  <motion.tr
                    key={s.name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors"
                  >
                    <td className="px-5 py-2.5 text-zinc-600 text-xs font-mono">{i + 1}</td>
                    <td className="px-5 py-2.5">
                      <span className="font-medium" style={{ color: getPersonalityColor(s.personality) }}>
                        {PERSONALITY_ICONS[s.personality?.toLowerCase()] ?? ''} {s.name}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-emerald-400 font-medium">{s.completedTasks}</td>
                    <td className="px-5 py-2.5 text-right text-red-400/70">{s.failedTasks}</td>
                    <td className="px-5 py-2.5 text-right">
                      <span className={`font-medium ${s.successRate >= 70 ? 'text-emerald-400' : s.successRate >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                        {s.successRate}%
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-zinc-300">{s.relationships}</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
