'use client';

import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Town } from '@/lib/townStore';

interface Props {
  town: Town;
}

function formatDate(ts: number): string {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

function formatCoords(c: { x: number; y: number; z: number }): string {
  return `${Math.round(c.x)}, ${Math.round(c.y)}, ${Math.round(c.z)}`;
}

/**
 * The status pill that sits at the top of the /town page next to the
 * picker. Shows tier, population, capital coords, founded date.
 */
export function TownStatusCard({ town }: Props) {
  return (
    <div className="flex items-center gap-3 bg-zinc-900/80 border border-zinc-800/60 rounded-xl px-3 py-2">
      <div className="flex flex-col">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
          Town
        </span>
        <span className="text-sm font-bold text-white leading-tight">{town.name}</span>
      </div>
      <span className="w-px h-8 bg-zinc-800" aria-hidden />
      <StatusBadge status={town.tier} size="sm" />
      <StatusBadge status={town.status} size="sm" />
      <span className="w-px h-8 bg-zinc-800" aria-hidden />
      <div className="flex flex-col">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
          Pop
        </span>
        <span className="text-sm font-bold text-emerald-400 tabular-nums leading-tight">
          {town.population}
        </span>
      </div>
      <span className="w-px h-8 bg-zinc-800" aria-hidden />
      <div className="flex flex-col">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
          Capital
        </span>
        <span className="text-sm font-mono text-zinc-300 leading-tight">
          {formatCoords(town.capital)}
        </span>
      </div>
      <span className="w-px h-8 bg-zinc-800" aria-hidden />
      <div className="flex flex-col">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
          Founded
        </span>
        <span className="text-sm text-zinc-300 leading-tight">{formatDate(town.foundedAt)}</span>
      </div>
    </div>
  );
}
