'use client';

import { useEffect, useState } from 'react';
import { api, type ChildTownDTO } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useTownStore } from '@/lib/townStore';

interface Props {
  townId: string;
}

const POLL_MS = 30_000;

/**
 * Phase 5-B Child Towns card.
 *
 * Lists every town whose `parentTownId` is the active town. Surfaces the
 * "Expand now" button for manual proposals (POST /api/towns/:id/expand) —
 * the backend handles eligibility (tier, population, daily cap, approval),
 * so the button is always enabled and we toast the rejection reason.
 */
export function ChildTownsCard({ townId }: Props) {
  const { toast } = useToast();
  const [children, setChildren] = useState<ChildTownDTO[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanding, setExpanding] = useState(false);
  // Phase 6-A — /expand is mayor-gated; pull the mayor name from the store so
  // we can pass it in the request body.
  const mayorPlayerName = useTownStore(
    (s) => s.towns.find((t) => t.id === townId)?.mayorPlayerName ?? null,
  );

  const refresh = async () => {
    const { children: list } = await api.listChildTowns(townId);
    setChildren(list);
    setLoaded(true);
  };

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const { children: list } = await api.listChildTowns(townId);
      if (cancelled) return;
      setChildren(list);
      setLoaded(true);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [townId]);

  const handleExpand = async () => {
    if (expanding) return;
    if (!mayorPlayerName) {
      toast('Only the mayor can expand the town — no mayor is set.', 'error');
      return;
    }
    setExpanding(true);
    try {
      const res = await api.requestExpansion(townId, mayorPlayerName);
      if (res.executed && res.childTown) {
        toast(
          `Founded ${res.childTown.name} ${res.proposal.direction.toLowerCase()} of capital`,
          'success',
        );
        // Optimistic refresh so the new child appears without waiting for
        // the 30s poll.
        refresh();
      } else if (res.proposal && !res.executed) {
        toast(
          `Proposal "${res.proposal.childName}" pending approval (Phase 6 wires the approval flow)`,
          'info',
        );
      } else {
        toast('Expansion proposed', 'info');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Expansion failed';
      toast(msg, 'error');
    } finally {
      setExpanding(false);
    }
  };

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-white">Child Towns</h3>
          <p className="text-[10px] text-zinc-500 mt-0.5">
            Self-expansion — towns this one has founded ~256 blocks away.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExpand}
          disabled={expanding}
          title="Propose a child town now. Backend gates by tier/population/daily-cap."
          className="shrink-0 text-[11px] font-semibold text-white bg-emerald-600/90 hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-wait transition-colors px-3 py-1.5 rounded-md"
        >
          {expanding ? 'Working…' : '+ Expand now'}
        </button>
      </header>

      <div className="p-4">
        {!loaded ? (
          <div className="text-center py-6 text-xs text-zinc-500">Loading child towns…</div>
        ) : children.length === 0 ? (
          <div className="text-center py-6 text-xs text-zinc-500">
            No child towns yet. When this town reaches the `town` tier and hits its population
            target, the brain proposes one automatically.
          </div>
        ) : (
          <ul className="space-y-2">
            {children.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border border-zinc-800/60 bg-zinc-950/40"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-100 truncate">{c.name}</span>
                    <span
                      className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border ${tierChip(
                        c.tier,
                      )}`}
                    >
                      {c.tier}
                    </span>
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 flex items-center gap-2">
                    <span>
                      {c.population} resident{c.population === 1 ? '' : 's'}
                    </span>
                    <span>·</span>
                    <span>
                      {c.distanceFromParent != null
                        ? `${c.distanceFromParent} blocks from capital`
                        : 'distance unknown'}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 text-[10px] text-zinc-500 font-mono">
                  ({Math.round(c.capital.x)}, {Math.round(c.capital.z)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function tierChip(tier: ChildTownDTO['tier']): string {
  switch (tier) {
    case 'town':
      return 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10';
    case 'village':
      return 'border-cyan-500/30 text-cyan-300 bg-cyan-500/10';
    case 'founding':
    default:
      return 'border-zinc-700/60 text-zinc-400 bg-zinc-800/40';
  }
}

export default ChildTownsCard;
