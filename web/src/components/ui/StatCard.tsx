'use client';

import type { ReactNode } from 'react';

export type StatCardIntent = 'default' | 'success' | 'warning' | 'danger';
export type StatCardTrend = 'up' | 'down' | 'flat';

export interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  trend?: StatCardTrend;
  intent?: StatCardIntent;
  icon?: ReactNode;
}

const INTENT_COLORS: Record<StatCardIntent, string> = {
  default: '#E4E4E7',
  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
};

const TREND_COLORS: Record<StatCardTrend, string> = {
  up: '#10B981',
  down: '#EF4444',
  flat: '#6B7280',
};

function TrendArrow({ trend }: { trend: StatCardTrend }) {
  const color = TREND_COLORS[trend];
  if (trend === 'up') {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 15 12 9 18 15" />
      </svg>
    );
  }
  if (trend === 'down') {
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function StatCard({ label, value, hint, trend, intent = 'default', icon }: StatCardProps) {
  const valueColor = INTENT_COLORS[intent];

  return (
    <div className="min-w-[120px] bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-3 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 truncate">
          {label}
        </span>
        {icon && <span className="text-zinc-500 shrink-0">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-xl font-bold tabular-nums leading-tight"
          style={{ color: valueColor }}
        >
          {value}
        </span>
        {trend && <TrendArrow trend={trend} />}
      </div>
      {hint && (
        <span className="text-[10px] text-zinc-500 truncate" title={hint}>
          {hint}
        </span>
      )}
    </div>
  );
}

export default StatCard;
