'use client';

import { useEffect, useState } from 'react';
import { api, type TownResourceDemand } from '@/lib/api';

/**
 * Resource Demand card — read-only view of the town demand loop's shortage math
 * (aggregate resident inventory vs the tier threshold per core resource). This
 * is the operator's window into "what is the town short on", the exact class of
 * problem (e.g. iron perpetually scarce) the backend demand/dedup work fixed.
 *
 * Polls every 15s; the demand loop itself re-evaluates on the brain tick (~60s),
 * so a 15s poll keeps the bars reasonably fresh without hammering the API.
 * Errors swallow (api.getTownDemand catches) so the card just shows a hint.
 */
interface Props {
  townId: string;
}

const POLL_MS = 15_000;

const RESOURCE_COLOR: Record<string, string> = {
  wood: '#A16207',
  stone: '#71717A',
  food: '#16A34A',
  iron: '#D4D4D8',
};

export function ResourceDemandCard({ townId }: Props) {
  const [demand, setDemand] = useState<TownResourceDemand[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setDemand(null);
    const tick = async () => {
      const res = await api.getTownDemand(townId);
      if (cancelled) return;
      setDemand(res?.demand ?? null);
      setLoaded(true);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [townId]);

  const shortfalls = (demand ?? []).filter((d) => d.need > 0).length;

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Resource Demand</h3>
        <div className="flex items-center gap-2">
          {loaded && demand && (
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                shortfalls > 0
                  ? 'text-amber-300 bg-amber-500/10'
                  : 'text-emerald-300 bg-emerald-500/10'
              }`}
            >
              {shortfalls > 0 ? `${shortfalls} short` : 'stocked'}
            </span>
          )}
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">15s poll</span>
        </div>
      </header>
      <div className="p-4">
        {!loaded ? (
          <div className="text-center py-4 text-xs text-zinc-500">Loading demand…</div>
        ) : !demand || demand.length === 0 ? (
          <div className="text-center py-4 text-xs text-zinc-500">
            No demand data — the town brain populates this once it ticks.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {demand.map((d) => (
              <DemandRow key={d.resource} d={d} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DemandRow({ d }: { d: TownResourceDemand }) {
  const color = RESOURCE_COLOR[d.resource] ?? '#60A5FA';
  const pct = d.threshold > 0 ? Math.min(100, (d.have / d.threshold) * 100) : 100;
  const short = d.need > 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5">
          <span className="capitalize font-semibold text-zinc-200">{d.resource}</span>
          <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
            {d.role}
          </span>
          <span className="text-[10px] text-zinc-600">{d.locale}</span>
        </span>
        <span className="tabular-nums text-zinc-400">
          <span className={short ? 'text-amber-300 font-semibold' : 'text-emerald-300'}>
            {d.have}
          </span>
          {' / '}
          {d.threshold}
          {short && <span className="text-amber-400/80"> (need {d.need})</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${pct}%`,
            backgroundColor: short ? color : '#10B981',
            opacity: short ? 0.85 : 1,
          }}
        />
      </div>
    </div>
  );
}

export default ResourceDemandCard;
