'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { api, type TownDTO } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { useToast } from '@/components/Toast';
import { useTownStore, type Town, type TownEvent } from '@/lib/townStore';
import { TownPicker } from '@/components/town/TownPicker';
import { TownStatusCard } from '@/components/town/TownStatusCard';
import { FoundTownModal } from '@/components/town/FoundTownModal';
import { RoleBreakdownCard } from '@/components/town/RoleBreakdownCard';
import { ScheduleStripCard } from '@/components/town/ScheduleStripCard';
import { RoleResidentList } from '@/components/town/RoleResidentList';

/**
 * The API may return `paused` as optional (older builds) or omit it entirely
 * before the Phase 2 backend ships. Force a boolean so the store invariant
 * (Town.paused: boolean) holds in every code path.
 */
function dtoToTown(dto: TownDTO): Town {
  return { ...dto, paused: dto.paused === true } as Town;
}

const EVENT_POLL_MS = 5000;
const TOWN_LIST_POLL_MS = 15000;

const STYLE_LABELS: Record<Town['styleSeed'], string> = {
  'medieval-communal': 'Medieval Communal',
  'mid-century-civic': 'Mid-Century Civic',
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatLong(ts: number): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '—';
  }
}

export default function TownPage() {
  const { toast } = useToast();
  const towns = useTownStore((s) => s.towns);
  const activeTownId = useTownStore((s) => s.activeTownId);
  const setTowns = useTownStore((s) => s.setTowns);

  const [loading, setLoading] = useState(true);
  const [foundModalOpen, setFoundModalOpen] = useState(false);
  const [events, setEvents] = useState<TownEvent[]>([]);
  const [buildingCount, setBuildingCount] = useState<number | null>(null);

  const activeTown: Town | null = useMemo(
    () => towns.find((t) => t.id === activeTownId) ?? null,
    [towns, activeTownId],
  );

  const refreshTowns = useCallback(async () => {
    try {
      const { towns: list } = await api.listTowns();
      setTowns(list.map(dtoToTown));
    } catch {
      // Backend not ready yet — leave the empty state up rather than toasting
      // every 15s while the parallel agent ships the API.
    } finally {
      setLoading(false);
    }
  }, [setTowns]);

  // Initial load + slow background refetch of the town list.
  useEffect(() => {
    refreshTowns();
    const id = setInterval(refreshTowns, TOWN_LIST_POLL_MS);
    return () => clearInterval(id);
  }, [refreshTowns]);

  // Fast poll of events + building count for the active town.
  useEffect(() => {
    if (!activeTownId) {
      setEvents([]);
      setBuildingCount(null);
      return;
    }
    let cancelled = false;

    const tick = async () => {
      try {
        const [evRes, bRes] = await Promise.all([
          api.getTownEvents(activeTownId, { limit: 10 }),
          api.getTownBuildings(activeTownId),
        ]);
        if (cancelled) return;
        setEvents(evRes.events as TownEvent[]);
        setBuildingCount(bRes.buildings.length);
      } catch {
        // ignore — backend may be offline
      }
    };

    tick();
    const id = setInterval(tick, EVENT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeTownId]);

  const handleCreated = (t: Town) => {
    // Force-refresh from the canonical source after a creation so we don't
    // rely solely on the optimistic upsert from the modal.
    refreshTowns();
    toast(`Switched to ${t.name}`, 'info');
  };

  return (
    <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
      <PageHeader
        title="Town"
        subtitle="Autonomous town builder — shell (Phase 1). Autonomy wires in Phase 2."
      >
        <button
          type="button"
          onClick={() => setFoundModalOpen(true)}
          className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors px-4 py-2 rounded-md shadow-sm"
        >
          + Found New Town
        </button>
      </PageHeader>

      {/* Sticky top strip */}
      {(towns.length > 0 || activeTown) && (
        <div className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-[#09090b]/95 backdrop-blur border-b border-zinc-800/60 flex items-center gap-3 flex-wrap">
          <TownPicker />
          {activeTown && <TownStatusCard town={activeTown} />}
        </div>
      )}

      {/* Empty state */}
      {!loading && towns.length === 0 && (
        <EmptyState onFound={() => setFoundModalOpen(true)} />
      )}

      {loading && towns.length === 0 && (
        <div className="text-center py-20 text-zinc-500 text-sm">Loading towns…</div>
      )}

      {/* No active town selected but towns exist (rare — store auto-selects) */}
      {!loading && towns.length > 0 && !activeTown && (
        <div className="text-center py-20 text-zinc-500 text-sm">
          Pick a town from the dropdown above.
        </div>
      )}

      {/* Body: when a town is active */}
      {activeTown && (
        <TownBody town={activeTown} events={events} buildingCount={buildingCount} />
      )}

      <FoundTownModal
        open={foundModalOpen}
        onClose={() => setFoundModalOpen(false)}
        onCreated={handleCreated}
        defaultMayorUsername="packetloss404"
      />
    </div>
  );
}

// ─── Empty state (no towns yet) ───────────────────────────────────────────

function EmptyState({ onFound }: { onFound: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="text-center py-20 max-w-md mx-auto"
    >
      <div className="text-5xl mb-4" aria-hidden>
        <HouseIcon size={56} />
      </div>
      <h2 className="text-lg font-bold text-white mb-1">No towns yet</h2>
      <p className="text-sm text-zinc-500 mb-5">
        Found your first town to give bots a place to build, defend, and chronicle. Set the style
        once — the town evolves from there.
      </p>
      <button
        type="button"
        onClick={onFound}
        className="text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors px-5 py-2.5 rounded-md shadow-sm"
      >
        Found Your First Town
      </button>
    </motion.div>
  );
}

// ─── Body (active town selected) ──────────────────────────────────────────

interface BodyProps {
  town: Town;
  events: TownEvent[];
  buildingCount: number | null;
}

function TownBody({ town, events, buildingCount }: BodyProps) {
  return (
    <div className="space-y-4">
      {/* Welcome banner */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="bg-gradient-to-br from-emerald-500/10 via-zinc-900/40 to-zinc-900/0 border border-emerald-500/20 rounded-xl p-5 flex items-center gap-4"
      >
        <div className="shrink-0 w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-400">
          <HouseIcon size={28} />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold text-white truncate">Welcome to {town.name}</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Founded {formatLong(town.foundedAt)} &middot;{' '}
            <span className="text-emerald-400 font-semibold">{STYLE_LABELS[town.styleSeed]}</span>
          </p>
        </div>
        <StylePresetBadge preset={town.styleSeed} />
      </motion.div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Population"
          value={town.population}
          hint={`${town.tier} tier`}
          intent={town.population > 0 ? 'success' : 'default'}
        />
        <StatCard
          label="Buildings"
          value={buildingCount ?? '—'}
          hint="Built + planned"
        />
        <StatCard
          label="Capital"
          value={`${Math.round(town.capital.x)},${Math.round(town.capital.z)}`}
          hint={`y=${Math.round(town.capital.y)}`}
        />
        <StatCard
          label="Style"
          value={STYLE_LABELS[town.styleSeed]}
          hint="Founding preset"
        />
      </div>

      {/* Roles + schedule (Phase 3) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RoleBreakdownCard townId={town.id} />
        <ScheduleStripCard townId={town.id} />
      </div>
      <RoleResidentList townId={town.id} />

      {/* Two-column: events + quick actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RecentEventsPanel events={events} />
        <QuickActionsPanel town={town} />
      </div>
    </div>
  );
}

// ─── Recent events panel ──────────────────────────────────────────────────

function RecentEventsPanel({ events }: { events: TownEvent[] }) {
  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Recent Events</h3>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Live · 5s poll</span>
      </header>
      <div className="divide-y divide-zinc-800/60 max-h-[420px] overflow-y-auto">
        {events.length === 0 ? (
          <div className="px-4 py-10 text-center text-xs text-zinc-500">
            No events yet. Once the town brain ticks (Phase 2), activity will stream here.
          </div>
        ) : (
          events.map((e) => <EventRow key={e.id} event={e} />)
        )}
      </div>
    </section>
  );
}

function EventRow({ event }: { event: TownEvent }) {
  const severityColor =
    event.severity === 'critical'
      ? '#EF4444'
      : event.severity === 'major'
      ? '#F59E0B'
      : event.severity === 'minor'
      ? '#3B82F6'
      : '#6B7280';
  return (
    <div className="px-4 py-2.5 flex items-start gap-3 hover:bg-zinc-800/30 transition-colors">
      <span
        className="mt-1.5 w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: severityColor }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-zinc-200 truncate">{event.kind}</span>
          {event.highlightScore >= 70 && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded">
              Highlight
            </span>
          )}
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5 flex items-center gap-2">
          <span className="uppercase tracking-wider">{event.severity}</span>
          <span>·</span>
          <span>{timeAgo(event.occurredAt)}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Quick actions ────────────────────────────────────────────────────────

function QuickActionsPanel({ town }: { town: Town }) {
  const { toast } = useToast();
  const setTownPaused = useTownStore((s) => s.setTownPaused);
  const [busy, setBusy] = useState(false);

  const handleTogglePause = async () => {
    if (busy) return;
    setBusy(true);
    const nextPaused = !town.paused;
    try {
      if (nextPaused) {
        await api.pauseTown(town.id);
      } else {
        await api.resumeTown(town.id);
      }
      setTownPaused(town.id, nextPaused);
      toast(nextPaused ? `Paused ${town.name}` : `Resumed ${town.name}`, 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Action failed';
      toast(msg, 'error');
    } finally {
      setBusy(false);
    }
  };

  const pauseLabel = town.paused ? 'Resume Town' : 'Pause Town';
  const pauseTooltip = town.paused
    ? 'Resumes the Town Brain. Bots return to proactive autonomy.'
    : 'Freezes the Town Brain. Bots stay alive but stop proactively acting.';

  return (
    <section className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
      <header className="px-4 py-3 border-b border-zinc-800/60">
        <h3 className="text-sm font-bold text-white">Quick Actions</h3>
        <p className="text-[10px] text-zinc-500 mt-0.5">
          Pause toggles autonomy. The other two wire in later phases.
        </p>
      </header>
      <div className="p-4 space-y-2">
        <button
          type="button"
          onClick={handleTogglePause}
          disabled={busy}
          title={pauseTooltip}
          className={`w-full text-left px-3 py-2.5 rounded-lg border text-xs flex items-center justify-between gap-2 transition-colors disabled:opacity-60 disabled:cursor-wait ${
            town.paused
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
              : 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
          }`}
        >
          <span className="font-semibold">{busy ? 'Working…' : pauseLabel}</span>
          <span
            className={`text-[9px] uppercase tracking-wider ${
              town.paused ? 'text-emerald-400/80' : 'text-amber-400/80'
            }`}
          >
            {town.paused ? 'Paused' : 'Active'}
          </span>
        </button>
        <DisabledAction
          label="Memorial Park"
          tooltip="Jumps the map to the Memorial Park footprint. (Phase 5)"
        />
        <DisabledAction
          label="Manual override task"
          tooltip="Insert a one-off task that bypasses the Town Brain queue. (Phase 2)"
        />
      </div>
    </section>
  );
}

function DisabledAction({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <button
      type="button"
      disabled
      title={tooltip}
      className="w-full text-left px-3 py-2.5 rounded-lg border border-zinc-800/60 bg-zinc-950/60 text-xs text-zinc-500 cursor-not-allowed flex items-center justify-between gap-2"
    >
      <span className="font-semibold">{label}</span>
      <span className="text-[9px] uppercase tracking-wider text-zinc-600">Soon</span>
    </button>
  );
}

// ─── Bits ─────────────────────────────────────────────────────────────────

function StylePresetBadge({ preset }: { preset: Town['styleSeed'] }) {
  if (preset === 'mid-century-civic') {
    return (
      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
        Mid-Century Civic
      </span>
    );
  }
  return (
    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-300 border border-amber-500/20">
      Medieval Communal
    </span>
  );
}

function HouseIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" />
    </svg>
  );
}
