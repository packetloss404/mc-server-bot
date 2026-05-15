'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { ProgressBar } from '@/components/ui/ProgressBar';

interface Props {
  botName: string;
}

interface Reputation {
  overall: number;
  reliability: number;
  cooperation: number;
  competence: number;
  recentTrend: 'rising' | 'falling' | 'stable' | string;
  totalEvents: number;
  lastUpdated: number;
}

export function BotTabReputation({ botName }: Props) {
  const [reputation, setReputation] = useState<Reputation | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      api
        .getBotReputation(botName)
        .then((data) => {
          setReputation(data.reputation);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [botName]);

  if (error) {
    return (
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Reputation</h2>
        <p className="text-xs text-red-400 text-center py-3">{error}</p>
      </div>
    );
  }

  if (!reputation) {
    return (
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Reputation</h2>
        <p className="text-xs text-zinc-600 text-center py-3">Loading reputation...</p>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Reputation</h2>
        <TrendPill trend={reputation.recentTrend} />
      </div>

      <div className="mb-4 p-3 rounded-lg bg-zinc-800/40 border border-zinc-800/60">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Overall</span>
          <span className="text-2xl font-bold text-white tabular-nums">{Math.round(reputation.overall)}</span>
        </div>
        <div className="mt-1">
          <ProgressBar value={reputation.overall} max={100} height="md" color={scoreColor(reputation.overall)} />
        </div>
      </div>

      <div className="space-y-3">
        <ReputationBar label="Reliability" value={reputation.reliability} />
        <ReputationBar label="Cooperation" value={reputation.cooperation} />
        <ReputationBar label="Competence" value={reputation.competence} />
      </div>

      <div className="mt-4 pt-3 border-t border-zinc-800/40 flex items-center justify-between text-[10px] text-zinc-500">
        <span>{reputation.totalEvents} events tracked</span>
        {reputation.lastUpdated > 0 && (
          <span>Updated {formatRelative(reputation.lastUpdated)}</span>
        )}
      </div>
    </motion.div>
  );
}

function ReputationBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-zinc-400 font-medium">{label}</span>
        <span className="text-[11px] text-zinc-300 tabular-nums font-medium">{Math.round(value)}</span>
      </div>
      <ProgressBar value={value} max={100} height="md" color={scoreColor(value)} />
    </div>
  );
}

function TrendPill({ trend }: { trend: string }) {
  const map: Record<string, { label: string; color: string; bg: string; arrow: string }> = {
    rising: { label: 'Rising', color: '#10B981', bg: '#10B98115', arrow: '\u2191' },
    falling: { label: 'Falling', color: '#EF4444', bg: '#EF444415', arrow: '\u2193' },
    stable: { label: 'Stable', color: '#6B7280', bg: '#6B728015', arrow: '\u2192' },
  };
  const t = map[trend] ?? map.stable;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full uppercase tracking-wider"
      style={{ color: t.color, backgroundColor: t.bg }}
    >
      <span>{t.arrow}</span>
      {t.label}
    </span>
  );
}

function scoreColor(value: number): string {
  if (value >= 75) return '#10B981';
  if (value >= 50) return '#3B82F6';
  if (value >= 25) return '#F59E0B';
  return '#EF4444';
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}
