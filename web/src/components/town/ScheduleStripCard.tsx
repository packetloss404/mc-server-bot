'use client';

import { useEffect, useState } from 'react';
import { api, type TownSchedulesResponse } from '@/lib/api';

interface Props {
  townId: string;
}

const POLL_MS = 10_000;

const ROLE_ICONS: Record<string, string> = {
  lumberjack: '🪓',
  miner: '⛏',
  farmer: '🌾',
  blacksmith: '🔨',
  builder: '🧱',
  guard: '🛡',
  gatherer: '🧺',
  idle: '💤',
};

const ROLE_ORDER: string[] = [
  'lumberjack', 'miner', 'farmer', 'blacksmith',
  'builder', 'guard', 'gatherer', 'idle',
];

function iconFor(role: string): string {
  return ROLE_ICONS[role] ?? '•';
}

/**
 * Informational strip showing the current world-time phase (Day / Night)
 * and the per-role task previews for that phase. Polls every 10s.
 */
export function ScheduleStripCard({ townId }: Props) {
  const [data, setData] = useState<TownSchedulesResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const res = await api.getTownSchedules(townId);
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

  const phase = data?.phase ?? null;
  const schedules = data?.roleSchedules ?? {};

  // Stable role display order: canonical first, then any extras present in the
  // response in alpha order.
  const knownPresent = ROLE_ORDER.filter((r) => r in schedules);
  const extras = Object.keys(schedules)
    .filter((r) => !ROLE_ORDER.includes(r))
    .sort();
  const roles = [...knownPresent, ...extras];

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-white">Schedule</h3>
        <div className="flex items-center gap-2">
          {phase && <PhaseBadge phase={phase} />}
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">10s poll</span>
        </div>
      </header>

      <div className="p-4">
        {!loaded ? (
          <div className="text-center py-6 text-xs text-zinc-500">Loading schedule…</div>
        ) : !data || roles.length === 0 ? (
          <div className="text-center py-6 text-xs text-zinc-500">
            No role data yet. Once schedules are defined, today&apos;s tasks show here.
          </div>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1">
            {roles.map((role) => {
              const tasks = (phase === 'night' ? schedules[role]?.night : schedules[role]?.day) ?? [];
              return (
                <div
                  key={role}
                  className="min-w-[180px] flex-shrink-0 bg-zinc-950/60 border border-zinc-800/60 rounded-lg p-2.5"
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span aria-hidden className="text-sm">
                      {iconFor(role)}
                    </span>
                    <span className="text-[11px] font-bold text-zinc-200 capitalize">{role}</span>
                  </div>
                  {tasks.length === 0 ? (
                    <p className="text-[10px] text-zinc-600 italic">No tasks scheduled.</p>
                  ) : (
                    <ul className="space-y-1">
                      {tasks.map((task, i) => (
                        <li
                          key={`${role}-${i}`}
                          className="text-[10px] text-zinc-400 leading-snug flex gap-1"
                        >
                          <span aria-hidden className="text-zinc-600 shrink-0">
                            •
                          </span>
                          <span className="break-words">{task}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function PhaseBadge({ phase }: { phase: 'day' | 'night' }) {
  if (phase === 'day') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30">
        <span aria-hidden>☀</span>
        <span>Day</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
      <span aria-hidden>☾</span>
      <span>Night</span>
    </span>
  );
}

export default ScheduleStripCard;
