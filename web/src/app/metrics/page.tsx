'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useBotStore } from '@/lib/store';
import { api } from '@/lib/api';
import { getPersonalityColor, PERSONALITY_ICONS } from '@/lib/constants';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonStatRow, SkeletonList } from '@/components/SkeletonLoader';
import Link from 'next/link';

interface BotMetrics {
  name: string;
  personality: string;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
}

export default function MetricsPage() {
  const bots = useBotStore((s) => s.botList);
  const [metrics, setMetrics] = useState<BotMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const results: BotMetrics[] = [];
      for (const bot of bots) {
        try {
          const tasks = await api.getBotTasks(bot.name);
          const total = tasks.completedTasks.length + tasks.failedTasks.length;
          results.push({
            name: bot.name,
            personality: bot.personality,
            completedTasks: tasks.completedTasks.length,
            failedTasks: tasks.failedTasks.length,
            successRate: total > 0 ? Math.round((tasks.completedTasks.length / total) * 100) : 0,
          });
        } catch { /* skip */ }
      }
      setMetrics(results);
      setLoading(false);
    };
    load();
  }, [bots.length]);

  const totalTasks = metrics.reduce((s, m) => s + m.completedTasks + m.failedTasks, 0);
  const totalCompleted = metrics.reduce((s, m) => s + m.completedTasks, 0);
  const totalFailed = metrics.reduce((s, m) => s + m.failedTasks, 0);
  const overallRate = totalTasks > 0 ? Math.round((totalCompleted / totalTasks) * 100) : 0;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl">
      <PageHeader title="Metrics" subtitle="Performance metrics across your fleet" />

      {loading ? (
        <>
          <SkeletonStatRow count={4} />
          <SkeletonList count={5} />
        </>
      ) : metrics.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40"
        >
          <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <p className="text-sm text-zinc-500">No metrics data available</p>
          <p className="text-xs text-zinc-600 mt-1">
            <Link href="/manage" className="text-emerald-500 hover:text-emerald-400">Create bots</Link> and assign tasks to see metrics
          </p>
        </motion.div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard label="Total Tasks" value={totalTasks} color="#60A5FA" />
            <MetricCard label="Completed" value={totalCompleted} color="#10B981" />
            <MetricCard label="Failed" value={totalFailed} color="#EF4444" />
            <MetricCard label="Success Rate" value={`${overallRate}%`} color="#F59E0B" />
          </div>

          {/* Per-bot breakdown */}
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-800/60">
              <h2 className="text-sm font-semibold text-zinc-300">Per-Bot Breakdown</h2>
            </div>
            <div className="divide-y divide-zinc-800/30">
              {metrics.sort((a, b) => b.completedTasks - a.completedTasks).map((m, i) => {
                const color = getPersonalityColor(m.personality);
                const emoji = PERSONALITY_ICONS[m.personality?.toLowerCase()] ?? '';
                return (
                  <motion.div
                    key={m.name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className="px-5 py-3 flex items-center gap-4 hover:bg-zinc-800/20 transition-colors"
                  >
                    <span className="text-sm">{emoji}</span>
                    <Link href={`/bots/${m.name}`} className="text-xs font-medium w-28 truncate hover:text-emerald-400 transition-colors" style={{ color }}>
                      {m.name}
                    </Link>
                    <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${m.successRate}%`, backgroundColor: color }}
                      />
                    </div>
                    <span className="text-[11px] text-emerald-400 w-10 text-right font-mono">{m.completedTasks}</span>
                    <span className="text-[11px] text-red-400/70 w-8 text-right font-mono">{m.failedTasks}</span>
                    <span className="text-[11px] text-zinc-400 w-10 text-right font-mono">{m.successRate}%</span>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
    >
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
    </motion.div>
  );
}
