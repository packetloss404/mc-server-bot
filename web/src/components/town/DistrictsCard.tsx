'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type TownDistrictDTO } from '@/lib/api';

interface Props {
  townId: string;
}

const POLL_MS = 30_000;

const STYLE_META: Record<TownDistrictDTO['stylePreset'], { label: string; bg: string; fg: string; ring: string }> = {
  'medieval-communal': {
    label: 'Medieval',
    bg: 'bg-amber-500/10',
    fg: 'text-amber-300',
    ring: 'border-amber-500/20',
  },
  'mid-century-civic': {
    label: 'Mid-Century',
    bg: 'bg-cyan-500/10',
    fg: 'text-cyan-300',
    ring: 'border-cyan-500/20',
  },
};

/**
 * Phase 5-B Districts card.
 *
 * Polls `/api/towns/:id/districts` every 30s and renders one row per
 * district with a style-preset chip and an "active" marker on the district
 * the brain currently routes new builds into.
 *
 * "Active" heuristic: when the town has 2+ districts, the most-recently
 * founded non-default district is the active one (mirrors
 * `DistrictManager.getActiveDistrictFor`). Single-district towns mark the
 * only district as active.
 */
export function DistrictsCard({ townId }: Props) {
  const [districts, setDistricts] = useState<TownDistrictDTO[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const { districts: list } = await api.listTownDistricts(townId);
      if (cancelled) return;
      setDistricts(list);
      setLoaded(true);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [townId]);

  const activeId = useMemo(() => {
    if (districts.length === 0) return null;
    if (districts.length === 1) return districts[0].id;
    const nonDefault = districts.filter((d) => !d.isDefault);
    if (nonDefault.length === 0) return districts[0].id;
    // Pick the newest non-default by foundedAt (falls back to first when
    // foundedAt is missing from older payloads).
    const sorted = [...nonDefault].sort((a, b) => (b.foundedAt ?? 0) - (a.foundedAt ?? 0));
    return sorted[0].id;
  }, [districts]);

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Districts</h3>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
          {districts.length === 0 ? '30s poll' : `${districts.length} district${districts.length === 1 ? '' : 's'} · 30s poll`}
        </span>
      </header>

      <div className="p-4">
        {!loaded ? (
          <div className="text-center py-6 text-xs text-zinc-500">Loading districts…</div>
        ) : districts.length === 0 ? (
          <div className="text-center py-6 text-xs text-zinc-500">
            No districts yet. The founding district is created when the town is founded.
          </div>
        ) : (
          <ul className="space-y-2">
            {districts.map((d) => {
              const meta = STYLE_META[d.stylePreset] ?? STYLE_META['medieval-communal'];
              const isActive = d.id === activeId;
              return (
                <li
                  key={d.id}
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border ${
                    isActive
                      ? 'border-emerald-500/40 bg-emerald-500/5'
                      : 'border-zinc-800/60 bg-zinc-950/40'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-zinc-100 truncate">
                        {d.name || 'Unnamed District'}
                      </span>
                      {d.isDefault && (
                        <span className="text-[9px] uppercase tracking-wider font-bold text-zinc-500 bg-zinc-800/80 px-1.5 py-0.5 rounded">
                          Founding
                        </span>
                      )}
                      {isActive && (
                        <span className="text-[9px] uppercase tracking-wider font-bold text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-500 mt-0.5">
                      {d.foundedAt ? new Date(d.foundedAt).toLocaleDateString() : 'Founding district'}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${meta.bg} ${meta.fg} ${meta.ring}`}
                  >
                    {meta.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

export default DistrictsCard;
