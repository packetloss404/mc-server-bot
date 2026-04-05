'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { api, MetricsData } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { STATE_COLORS, STATE_LABELS, PERSONALITY_COLORS } from '@/lib/constants';

const REFRESH_INTERVAL = 30_000;

/* ── Reusable metric card ── */
function MetricCard({
  label,
  value,
  sub,
  color = 'text-white',
  delay = 0,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
    >
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-500 mt-0.5">{sub}</p>}
    </motion.div>
  );
}

/* ── Horizontal bar ── */
function HBar({
  label,
  value,
  max,
  color,
  delay = 0,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  delay?: number;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-zinc-400 w-28 truncate text-right">{label}</span>
      <div className="flex-1 h-5 bg-zinc-800 rounded overflow-hidden">
        <motion.div
          className="h-full rounded flex items-center px-2"
          style={{ backgroundColor: `${color}40` }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(pct, value > 0 ? 6 : 0)}%` }}
          transition={{ duration: 0.5, delay }}
        >
          {value > 0 && (
            <span className="text-[10px] font-bold" style={{ color }}>
              {value}
            </span>
          )}
        </motion.div>
      </div>
    </div>
  );
}

/* ── CSS donut chart ── */
function DonutChart({
  segments,
  size = 120,
  thickness = 14,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  size?: number;
  thickness?: number;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total === 0) {
    return (
      <div
        className="rounded-full border-2 border-zinc-800 flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <span className="text-xs text-zinc-600">No data</span>
      </div>
    );
  }

  let cumulativePct = 0;
  const gradientStops: string[] = [];
  for (const seg of segments) {
    const startPct = cumulativePct;
    const endPct = cumulativePct + (seg.value / total) * 100;
    gradientStops.push(`${seg.color} ${startPct}% ${endPct}%`);
    cumulativePct = endPct;
  }

  const innerSize = size - thickness * 2;

  return (
    <div className="flex items-center gap-4">
      <div className="relative" style={{ width: size, height: size }}>
        <div
          className="rounded-full"
          style={{
            width: size,
            height: size,
            background: `conic-gradient(${gradientStops.join(', ')})`,
          }}
        />
        <div
          className="absolute bg-zinc-900 rounded-full flex items-center justify-center"
          style={{
            width: innerSize,
            height: innerSize,
            top: thickness,
            left: thickness,
          }}
        >
          <span className="text-lg font-bold text-white">{total}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        {segments
          .filter((s) => s.value > 0)
          .map((seg) => (
            <div key={seg.label} className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              <span className="text-[11px] text-zinc-400">
                {seg.label}{' '}
                <span className="text-zinc-300 font-medium">{seg.value}</span>
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}

/* ── Progress ring (for percentages) ── */
function ProgressRing({
  pct,
  label,
  color,
  size = 80,
}: {
  pct: number;
  label: string;
  color: string;
  size?: number;
}) {
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#27272a"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8 }}
        />
      </svg>
      <div className="absolute flex flex-col items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-lg font-bold" style={{ color }}>
          {pct}%
        </span>
      </div>
      <span className="text-[10px] text-zinc-500 font-medium">{label}</span>
    </div>
  );
}

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<number>(0);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getMetrics();
      setMetrics(data);
      setLastRefresh(Date.now());
    } catch {
      /* keep stale data on error */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_INTERVAL);
    return () => clearInterval(id);
  }, [refresh]);

  const timeSinceRefresh = lastRefresh
    ? `Last updated ${Math.round((Date.now() - lastRefresh) / 1000)}s ago`
    : '';

  if (loading) {
    return (
      <div className="p-6 lg:p-8 max-w-6xl">
        <PageHeader title="Metrics" subtitle="Loading..." />
        <div className="py-16 text-center">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-zinc-500">Gathering metrics...</p>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="p-6 lg:p-8 max-w-6xl">
        <PageHeader title="Metrics" subtitle="Unable to load metrics" />
        <div className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40">
          <p className="text-sm text-zinc-500">Could not reach the metrics endpoint</p>
          <button onClick={refresh} className="mt-3 px-4 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors">
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { bots, tasks, commands, missions, commander, fleet, skills } = metrics;

  // Prepare state breakdown bars
  const stateEntries = Object.entries(bots.stateBreakdown).sort((a, b) => b[1] - a[1]);
  const maxStateCount = Math.max(1, ...stateEntries.map(([, v]) => v));

  // Prepare personality breakdown
  const personalityEntries = Object.entries(bots.personalityBreakdown).sort((a, b) => b[1] - a[1]);

  // Donut for commands
  const commandSegments = [
    { label: 'Succeeded', value: commands.succeeded, color: '#10B981' },
    { label: 'Failed', value: commands.failed, color: '#EF4444' },
    { label: 'Pending', value: commands.pending, color: '#F59E0B' },
    { label: 'Cancelled', value: commands.cancelled, color: '#6B7280' },
  ];

  // Donut for missions
  const missionSegments = [
    { label: 'Completed', value: missions.completed, color: '#10B981' },
    { label: 'Active', value: missions.active, color: '#3B82F6' },
    { label: 'Failed', value: missions.failed, color: '#EF4444' },
    { label: 'Paused', value: missions.paused, color: '#F59E0B' },
  ];

  // Donut for tasks
  const taskSegments = [
    { label: 'Completed', value: tasks.totalCompleted, color: '#10B981' },
    { label: 'Failed', value: tasks.totalFailed, color: '#EF4444' },
    { label: 'Queued', value: tasks.totalQueued, color: '#F59E0B' },
    { label: 'Active', value: tasks.activeTasks, color: '#3B82F6' },
  ];

  // Fleet role bars
  const roleEntries = Object.entries(fleet.botsByRole).sort((a, b) => b[1] - a[1]);
  const maxRoleCount = Math.max(1, ...roleEntries.map(([, v]) => v));
  const ROLE_COLORS: Record<string, string> = {
    guard: '#4A90D9',
    farmer: '#F39C12',
    explorer: '#27AE60',
    merchant: '#F5A623',
    blacksmith: '#E74C3C',
    builder: '#1ABC9C',
    elder: '#9B59B6',
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
      <PageHeader title="Metrics" subtitle={timeSinceRefresh}>
        <button
          onClick={refresh}
          className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors flex items-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9" />
            <path d="M21 3v6h-6" />
          </svg>
          Refresh
        </button>
      </PageHeader>

      {/* ══ Top-level summary cards ══ */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard label="Total Bots" value={bots.total} sub={`${bots.alive} online`} color="text-emerald-400" delay={0} />
        <MetricCard label="Working" value={bots.working} sub={`${bots.idle} idle`} color="text-cyan-400" delay={0.03} />
        <MetricCard label="Tasks Done" value={tasks.totalCompleted} sub={`${tasks.successRate}% success`} color="text-emerald-400" delay={0.06} />
        <MetricCard label="Tasks Failed" value={tasks.totalFailed} color="text-red-400" delay={0.09} />
        <MetricCard label="Skills" value={skills.count} color="text-yellow-400" delay={0.12} />
        <MetricCard label="Active Tasks" value={tasks.activeTasks} sub={`${tasks.totalQueued} queued`} color="text-blue-400" delay={0.15} />
      </div>

      {/* ══ Bot Activity & State Breakdown ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* State breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
        >
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Bot States</h2>
          {stateEntries.length === 0 ? (
            <p className="text-xs text-zinc-600">No bots online</p>
          ) : (
            <div className="space-y-2">
              {stateEntries.map(([state, count], i) => (
                <HBar
                  key={state}
                  label={STATE_LABELS[state] || state}
                  value={count}
                  max={maxStateCount}
                  color={STATE_COLORS[state] || '#6B7280'}
                  delay={i * 0.03}
                />
              ))}
            </div>
          )}
        </motion.div>

        {/* Personality breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
        >
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Personalities</h2>
          {personalityEntries.length === 0 ? (
            <p className="text-xs text-zinc-600">No bots spawned</p>
          ) : (
            <div className="space-y-2">
              {personalityEntries.map(([personality, count], i) => (
                <HBar
                  key={personality}
                  label={personality}
                  value={count}
                  max={Math.max(1, ...personalityEntries.map(([, v]) => v))}
                  color={PERSONALITY_COLORS[personality] || '#6B7280'}
                  delay={i * 0.03}
                />
              ))}
            </div>
          )}
        </motion.div>
      </div>

      {/* ══ Task, Command, Mission Donuts ══ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
        >
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Tasks</h2>
          <DonutChart segments={taskSegments} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
        >
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Commands</h2>
          <DonutChart segments={commandSegments} />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
        >
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Missions</h2>
          <DonutChart segments={missionSegments} />
        </motion.div>
      </div>

      {/* ══ Commander & Fleet Metrics ══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Commander metrics */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
        >
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Commander</h2>
          <div className="flex items-start gap-6">
            <div className="relative">
              <ProgressRing pct={commander.avgConfidence} label="Avg Confidence" color="#10B981" />
            </div>
            <div className="space-y-3 flex-1">
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Parses</p>
                <p className="text-lg font-bold text-white">{commander.parseCount}</p>
              </div>
              <div>
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Failure Rate</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ backgroundColor: commander.failureRate > 30 ? '#EF4444' : commander.failureRate > 10 ? '#F59E0B' : '#10B981' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${commander.failureRate}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <span className="text-xs text-zinc-400 font-medium">{commander.failureRate}%</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Fleet metrics */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
        >
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Fleet</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Squads</p>
              <p className="text-lg font-bold text-white">
                {fleet.activeSquads}
                <span className="text-xs text-zinc-500 font-normal ml-1">/ {fleet.totalSquads}</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Overrides</p>
              <p className="text-lg font-bold text-yellow-400">{fleet.overrideCount}</p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium">Roles Assigned</p>
              <p className="text-lg font-bold text-white">{roleEntries.reduce((s, [, v]) => s + v, 0)}</p>
            </div>
          </div>
          {roleEntries.length > 0 && (
            <div className="space-y-2">
              {roleEntries.map(([role, count], i) => (
                <HBar
                  key={role}
                  label={role}
                  value={count}
                  max={maxRoleCount}
                  color={ROLE_COLORS[role] || '#6B7280'}
                  delay={i * 0.03}
                />
              ))}
            </div>
          )}
          {roleEntries.length === 0 && (
            <p className="text-xs text-zinc-600">No roles assigned yet</p>
          )}
        </motion.div>
      </div>

      {/* ══ Bot Health Table ══ */}
      {bots.healthStats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
        >
          <h2 className="text-sm font-semibold text-zinc-300 mb-4">Bot Health</h2>
          <div className="space-y-2">
            {bots.healthStats.map((bot) => (
              <div key={bot.name} className="flex items-center gap-3">
                <span className="text-xs text-zinc-400 w-28 truncate text-right">{bot.name}</span>
                <div className="flex-1 flex gap-2">
                  {/* Health bar */}
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="#EF4444" stroke="none">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                      <span className="text-[10px] text-zinc-500">{bot.health}/20</span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{
                          backgroundColor: bot.health > 14 ? '#10B981' : bot.health > 6 ? '#F59E0B' : '#EF4444',
                        }}
                        initial={{ width: 0 }}
                        animate={{ width: `${(bot.health / 20) * 100}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  </div>
                  {/* Food bar */}
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="#F59E0B" stroke="none">
                        <circle cx="12" cy="12" r="10" />
                      </svg>
                      <span className="text-[10px] text-zinc-500">{bot.food}/20</span>
                    </div>
                    <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{
                          backgroundColor: bot.food > 14 ? '#F59E0B' : bot.food > 6 ? '#D97706' : '#EF4444',
                        }}
                        initial={{ width: 0 }}
                        animate={{ width: `${(bot.food / 20) * 100}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ══ Per-Bot Task Breakdown ══ */}
      {tasks.botTaskStats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
        >
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-sm font-semibold text-zinc-300">Per-Bot Task Breakdown</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800/60 text-zinc-500 text-xs">
                <th className="text-left px-5 py-2.5 font-medium">Bot</th>
                <th className="text-right px-5 py-2.5 font-medium">Completed</th>
                <th className="text-right px-5 py-2.5 font-medium">Failed</th>
                <th className="text-right px-5 py-2.5 font-medium">Queued</th>
                <th className="text-left px-5 py-2.5 font-medium">Current Task</th>
              </tr>
            </thead>
            <tbody>
              {tasks.botTaskStats.map((bot, i) => {
                const pColor = PERSONALITY_COLORS[bot.personality?.toLowerCase()] || '#6B7280';
                return (
                  <motion.tr
                    key={bot.name}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-zinc-800/30 hover:bg-zinc-800/20 transition-colors"
                  >
                    <td className="px-5 py-2.5">
                      <span className="font-medium text-xs" style={{ color: pColor }}>
                        {bot.name}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-emerald-400 font-medium text-xs">{bot.completed}</td>
                    <td className="px-5 py-2.5 text-right text-red-400/70 text-xs">{bot.failed}</td>
                    <td className="px-5 py-2.5 text-right text-yellow-400/70 text-xs">{bot.queued}</td>
                    <td className="px-5 py-2.5 text-left text-xs text-zinc-400 max-w-[200px] truncate">
                      {bot.currentTask || <span className="text-zinc-600">--</span>}
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      )}

      {/* Auto-refresh indicator */}
      <div className="text-center">
        <p className="text-[10px] text-zinc-600">
          Auto-refreshes every 30s
        </p>
      </div>
    </div>
  );
}
