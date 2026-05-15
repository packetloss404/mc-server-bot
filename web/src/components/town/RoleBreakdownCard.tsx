'use client';

import { useEffect, useState } from 'react';
import { api, type TownRolesResponse } from '@/lib/api';

interface Props {
  townId: string;
}

const POLL_MS = 10_000;

// Emoji-only role icons (intentionally chose emoji over Lucide — keeps the
// component dependency-free and matches the spec's example string).
const ROLE_META: Record<string, { icon: string; label: string; color: string }> = {
  lumberjack:  { icon: '🪓', label: 'Lumberjack',  color: '#A16207' }, // amber-700
  miner:       { icon: '⛏',  label: 'Miner',       color: '#71717A' }, // zinc-500
  farmer:      { icon: '🌾', label: 'Farmer',      color: '#84CC16' }, // lime-500
  blacksmith:  { icon: '🔨', label: 'Blacksmith',  color: '#F59E0B' }, // amber-500
  builder:     { icon: '🧱', label: 'Builder',     color: '#D97706' }, // amber-600
  guard:       { icon: '🛡', label: 'Guard',       color: '#EF4444' }, // red-500
  gatherer:    { icon: '🧺', label: 'Gatherer',    color: '#10B981' }, // emerald-500
  idle:        { icon: '💤', label: 'Idle',        color: '#52525B' }, // zinc-600
};

const ROLE_ORDER: string[] = [
  'lumberjack', 'miner', 'farmer', 'blacksmith',
  'builder', 'guard', 'gatherer', 'idle',
];

function metaFor(role: string) {
  return (
    ROLE_META[role] ?? {
      icon: '•',
      label: role.charAt(0).toUpperCase() + role.slice(1),
      color: '#A1A1AA', // zinc-400
    }
  );
}

/**
 * Shows the population-by-role distribution for the active town. Polls
 * /api/towns/:id/roles every 10s. Degrades to "no role data yet" when the
 * backend hasn't shipped this endpoint or returns nothing.
 */
export function RoleBreakdownCard({ townId }: Props) {
  const [data, setData] = useState<TownRolesResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const res = await api.listTownRoles(townId);
      if (cancelled) return;
      setData(res);
      setLoaded(true);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [townId]);

  const breakdown = data?.breakdown ?? {};
  const total = Object.values(breakdown).reduce((sum, n) => sum + (n || 0), 0);

  // Build the display order: known roles in canonical order first, then any
  // unknown roles appended in alpha order.
  const knownPresent = ROLE_ORDER.filter((r) => (breakdown[r] ?? 0) > 0);
  const unknownPresent = Object.keys(breakdown)
    .filter((r) => !(r in ROLE_META) && (breakdown[r] ?? 0) > 0)
    .sort();
  const visibleRoles = [...knownPresent, ...unknownPresent];

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Role Breakdown</h3>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
          {total > 0 ? `${total} resident${total === 1 ? '' : 's'} · 10s poll` : '10s poll'}
        </span>
      </header>

      <div className="p-4">
        {!loaded ? (
          <div className="text-center py-6 text-xs text-zinc-500">Loading roles…</div>
        ) : !data || total === 0 ? (
          <div className="text-center py-6 text-xs text-zinc-500">
            No role data yet. Once residents are assigned roles, distribution shows here.
          </div>
        ) : (
          <div className="space-y-2.5">
            {/* Inline chip summary up top — quick scan */}
            <div className="flex items-center gap-2 flex-wrap pb-1">
              {visibleRoles.map((role) => {
                const meta = metaFor(role);
                const count = breakdown[role] ?? 0;
                return (
                  <span
                    key={`chip-${role}`}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-950/60 border border-zinc-800/60 text-zinc-200"
                    title={`${count} ${meta.label}${count === 1 ? '' : 's'}`}
                  >
                    <span aria-hidden>{meta.icon}</span>
                    <span className="tabular-nums">{count}</span>
                    <span className="text-zinc-500 lowercase">{meta.label}</span>
                  </span>
                );
              })}
            </div>

            {/* Bars per role */}
            <div className="space-y-1.5">
              {visibleRoles.map((role) => {
                const meta = metaFor(role);
                const count = breakdown[role] ?? 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={`bar-${role}`} className="flex items-center gap-2.5">
                    <span className="w-5 text-center text-sm" aria-hidden>
                      {meta.icon}
                    </span>
                    <span className="w-24 text-[11px] text-zinc-300 capitalize truncate">
                      {meta.label}
                    </span>
                    <div className="flex-1 h-2 bg-zinc-950/80 border border-zinc-800/60 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-[width] duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: meta.color,
                        }}
                      />
                    </div>
                    <span className="w-8 text-right text-[11px] font-semibold tabular-nums text-zinc-200">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default RoleBreakdownCard;
