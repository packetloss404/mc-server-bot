'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useBotStore } from '@/lib/store';
import {
  api,
  type SkillStatsResponse,
  type DifficultyResponse,
  type DifficultyTier,
} from '@/lib/api';
import { getPersonalityColor, PERSONALITY_ICONS } from '@/lib/constants';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { StatusBadge } from '@/components/ui/StatusBadge';

interface BotStats {
  name: string;
  personality: string;
  completedTasks: number;
  failedTasks: number;
  successRate: number;
  relationships: number;
}

const TIER_COLORS: Record<DifficultyTier, string> = {
  peaceful: '#3B82F6',
  easy: '#10B981',
  normal: '#A1A1AA',
  hard: '#F59E0B',
  challenge: '#EF4444',
};

function SkillLibraryPanel() {
  const [data, setData] = useState<SkillStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.getSkillStats();
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const successRate =
    data && data.totalSuccesses + data.totalFailures > 0
      ? data.totalSuccesses / (data.totalSuccesses + data.totalFailures)
      : 0;

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">Skill Library</h2>
        <Link
          href="/skills"
          className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          View all skills -&gt;
        </Link>
      </div>

      {loading && !data ? (
        <div className="py-8 text-center">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-[11px] text-zinc-500">Loading skill stats...</p>
        </div>
      ) : error ? (
        <div className="py-6 text-center">
          <p className="text-[11px] text-red-400">{error}</p>
        </div>
      ) : !data || data.total === 0 ? (
        <div className="py-8 text-center">
          <p className="text-xs text-zinc-500">No skills learned yet</p>
          <p className="text-[10px] text-zinc-600 mt-1">
            Skills appear as bots complete tasks
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Total Skills" value={data.total} hint={`${data.neverUsed} never used`} />
            <StatCard
              label="Avg Quality"
              value={data.averageQuality.toFixed(2)}
              intent="success"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-zinc-400 font-medium">Success rate</span>
              <span className="text-[11px] text-zinc-300 tabular-nums">
                {Math.round(successRate * 100)}%
              </span>
            </div>
            <ProgressBar
              value={successRate}
              max={1}
              intent={successRate >= 0.7 ? 'success' : successRate >= 0.4 ? 'warning' : 'danger'}
              height="md"
            />
            <p className="text-[10px] text-zinc-500 mt-1">
              {data.totalSuccesses} successes / {data.totalFailures} failures
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
                Top performers
              </p>
              {data.topPerformers.length === 0 ? (
                <p className="text-[11px] text-zinc-600">No successful runs yet</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.topPerformers.slice(0, 5).map((s) => (
                    <li
                      key={s.name}
                      className="flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="text-zinc-300 truncate" title={s.description ?? s.name}>
                        {s.name}
                      </span>
                      <span className="shrink-0 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                        {s.successCount}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">
                Needs attention
              </p>
              {data.topFailures.length === 0 ? (
                <p className="text-[11px] text-zinc-600">No failures recorded</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.topFailures.slice(0, 5).map((s) => (
                    <li
                      key={s.name}
                      className="flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="text-zinc-300 truncate" title={s.description ?? s.name}>
                        {s.name}
                      </span>
                      <span className="shrink-0 px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-mono">
                        {s.failureCount}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function DifficultyPanel() {
  const [data, setData] = useState<DifficultyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.getDifficulty();
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">Difficulty</h2>
        {data && (
          // StatusBadge resolves color from its known status map, which doesn't
          // include the difficulty-tier vocabulary — render a local pill so the
          // header chip matches the big tier card below.
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
            style={{
              backgroundColor: `${TIER_COLORS[data.tier]}20`,
              color: TIER_COLORS[data.tier],
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: TIER_COLORS[data.tier] }} />
            {data.tier}
          </span>
        )}
      </div>

      {loading && !data ? (
        <div className="py-8 text-center">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-[11px] text-zinc-500">Loading difficulty...</p>
        </div>
      ) : error ? (
        <div className="py-6 text-center">
          <p className="text-[11px] text-red-400">{error}</p>
        </div>
      ) : data ? (
        <>
          <div
            className="rounded-lg p-3 border"
            style={{
              backgroundColor: `${TIER_COLORS[data.tier]}10`,
              borderColor: `${TIER_COLORS[data.tier]}40`,
            }}
          >
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Current tier
            </p>
            <p
              className="text-2xl font-bold mt-0.5 capitalize"
              style={{ color: TIER_COLORS[data.tier] }}
            >
              {data.tier}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatCard label="Players" value={data.playerCount} />
            <StatCard
              label="Avg Skill"
              value={data.averagePlayerSkill.toFixed(2)}
              hint="0 = new, 1 = expert"
            />
          </div>

          <div className="space-y-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Behavior modifiers
            </p>
            <ProgressBar
              value={data.botAutonomy}
              max={1}
              label="Bot autonomy"
              showPercent
            />
            <ProgressBar
              value={data.eventFrequency}
              max={1}
              label="Event frequency"
              showPercent
              intent="warning"
            />
            <ProgressBar
              value={data.combatAggressiveness}
              max={1}
              label="Combat aggressiveness"
              showPercent
              intent="danger"
            />
            <ProgressBar
              value={data.helpfulness}
              max={1}
              label="Helpfulness"
              showPercent
              intent="success"
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function StatsPage() {
  const bots = useBotStore((s) => s.botList);
  const [stats, setStats] = useState<BotStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<'completed' | 'rate' | 'relationships'>('completed');

  // Bot store updates fire on every position/health/state event — re-running
  // the bots.map() fetch on every store push hammers /api/bots/:name/tasks
  // and /relationships. Key the effect on a stable bot-roster signature so
  // we only refetch when the SET of bots actually changes.
  const botRosterKey = useMemo(
    () => bots.map((b) => b.name).sort().join(','),
    [bots],
  );

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botRosterKey]);

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

      {/* Skill library + difficulty overview (server-wide; always visible) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SkillLibraryPanel />
        <DifficultyPanel />
      </div>

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
          {/* Summary Cards — three simple label+value tiles; leaderboard and
              detailed table panels below host composite content (progress
              bars / sort buttons / tabular rows) so they stay as bespoke
              <div> panels rather than StatCard. */}
          <div className="grid grid-cols-3 gap-3">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <StatCard label="Total Completed" value={totalCompleted} intent="success" />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
            >
              <StatCard label="Total Failed" value={totalFailed} intent="danger" />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <StatCard label="Avg Success Rate" value={`${avgRate}%`} />
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
