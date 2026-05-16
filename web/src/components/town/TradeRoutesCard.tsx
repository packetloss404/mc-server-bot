'use client';

import { useEffect, useState } from 'react';
import { api, type TradeRouteDTO } from '@/lib/api';

/**
 * Phase 7-B — Trade Routes card.
 *
 * Lists the in-flight allied-town trade routes originating from the active
 * town. Polls every 15s. The TradeRouteManager keeps each route in memory
 * for a 10-minute cooldown window after queueing, so this list naturally
 * GCs without explicit completion signals — completed deliveries simply
 * fall off the cooldown.
 *
 * Empty state covers four cases:
 *   - No active town selected.
 *   - The town has no allied peers in the diplomacy graph.
 *   - The town has allies but no surplus/shortage match this tick.
 *   - The backend hasn't shipped yet (api swallows GET failures).
 */
interface Props {
  townId: string;
}

const POLL_MS = 15_000;
const RESOURCE_ICON: Record<string, string> = {
  wood: '🪵',
  stone: '🪨',
  food: '🍞',
  iron: '⚙',
};

export function TradeRoutesCard({ townId }: Props) {
  const [routes, setRoutes] = useState<TradeRouteDTO[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setRoutes([]);
    const tick = async () => {
      const res = await api.listTradeRoutes(townId);
      if (cancelled) return;
      setRoutes(Array.isArray(res.routes) ? res.routes : []);
      setLoaded(true);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [townId]);

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Allied Trade Routes</h3>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">
          {routes.length > 0
            ? `${routes.length} in flight · 15s poll`
            : '15s poll'}
        </span>
      </header>
      <div className="p-4">
        {!loaded ? (
          <div className="text-center py-6 text-xs text-zinc-500">
            Loading trade routes…
          </div>
        ) : routes.length === 0 ? (
          <div className="text-center py-6 text-xs text-zinc-500">
            No active trade routes. Allied towns share surplus resources here when one runs low.
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {routes.map((r) => (
              <TradeRouteRow key={r.id} route={r} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function TradeRouteRow({ route }: { route: TradeRouteDTO }) {
  const icon = RESOURCE_ICON[route.resource] ?? '📦';
  return (
    <li className="py-2.5 flex items-center gap-3">
      <span className="text-xl shrink-0" aria-hidden>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-zinc-100 truncate">
          {route.amount} {route.resource}
          <span className="text-zinc-500 font-normal"> → </span>
          <span className="text-amber-300">{route.targetTownName}</span>
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5 flex items-center gap-2">
          <span>queued {timeAgo(route.queuedAt)}</span>
          <span>·</span>
          <span>cooldown {minutesUntil(route.expiresAt)}</span>
          {route.taskId ? (
            <>
              <span>·</span>
              <span className="font-mono text-zinc-600 truncate">task {route.taskId.slice(-6)}</span>
            </>
          ) : (
            <>
              <span>·</span>
              <span className="text-amber-500/80">no task</span>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

function minutesUntil(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return 'expired';
  const min = Math.ceil(diff / 60000);
  return `${min}m left`;
}

export default TradeRoutesCard;
