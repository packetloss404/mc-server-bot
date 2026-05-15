'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type SchematicInfo, type BuildRecord } from '@/lib/api';
import { formatItemName } from '@/lib/items';
import { Slot } from '@/components/ui/Slot';

interface Props {
  buildId: string;
  schematicFile: string;
  /**
   * Live build record from the parent. Used as a fast first-paint source so
   * we don't flash empty rows while waiting for the polling fetch. The
   * component still polls /api/builds/:id every 5s to stay current.
   */
  initialBuild?: BuildRecord | null;
}

interface MaterialRow {
  blockName: string;
  total: number;
  /**
   * Approximate placed count derived from the overall placedBlocks/totalBlocks
   * ratio. We don't currently track which specific blocks have been placed —
   * see the comment on `placedCounts` below.
   */
  placed: number;
  missing: number;
  pct: number;
}

const VISIBLE_ROWS = 20;

function stateColor(state: 'untouched' | 'in-progress' | 'complete'): {
  bg: string;
  border: string;
  text: string;
  bar: string;
} {
  switch (state) {
    case 'complete':
      return {
        bg: 'bg-emerald-500/5',
        border: 'border-emerald-500/30',
        text: 'text-emerald-300',
        bar: '#10B981',
      };
    case 'in-progress':
      return {
        bg: 'bg-amber-500/5',
        border: 'border-amber-500/30',
        text: 'text-amber-300',
        bar: '#F59E0B',
      };
    default:
      return {
        bg: 'bg-zinc-800/40',
        border: 'border-zinc-700/40',
        text: 'text-zinc-400',
        bar: '#52525B',
      };
  }
}

export function MaterialList({ buildId, schematicFile, initialBuild = null }: Props) {
  const [schematic, setSchematic] = useState<SchematicInfo | null>(null);
  const [build, setBuild] = useState<BuildRecord | null>(initialBuild);
  const [schematicError, setSchematicError] = useState<string | null>(null);
  const [loadingSchematic, setLoadingSchematic] = useState(true);
  const [expanded, setExpanded] = useState(false);

  // Fetch schematic metadata once per schematicFile so we have the palette.
  useEffect(() => {
    let cancelled = false;
    setSchematicError(null);
    setLoadingSchematic(true);
    api
      .getSchematic(schematicFile)
      .then((data) => {
        if (cancelled) return;
        setSchematic(data.schematic);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSchematicError(err instanceof Error ? err.message : 'Failed to load schematic');
      })
      .finally(() => {
        if (!cancelled) setLoadingSchematic(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schematicFile]);

  // Poll the build every 5s for live placed/total counts. Matches the existing
  // 5s cadence used by other dashboard pages — the active-build card itself
  // already mutates `activeBuild` in the bot store via the SocketProvider, but
  // we re-fetch here so the breakdown stays accurate even if this component
  // is dropped in elsewhere later.
  useEffect(() => {
    if (initialBuild) setBuild(initialBuild);
  }, [initialBuild]);

  // Terminal build statuses stop the poll — otherwise we'd hammer /api/builds
  // forever after a build finishes or is cancelled.
  const isTerminal = build && (
    build.status === 'completed' || build.status === 'cancelled' || build.status === 'failed'
  );

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (isTerminal) return;
      api
        .getBuild(buildId)
        .then((data) => {
          if (cancelled) return;
          setBuild(data.build);
        })
        .catch(() => {
          // Build may have been cleaned up; ignore — parent decides when to
          // unmount this component.
        });
    };
    tick();
    const handle = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [buildId, isTerminal]);

  const palette = schematic?.palette;

  // Per-block placed counts are an APPROXIMATION. The server only tracks the
  // aggregate `placedBlocks` total — not per-block-type placement counts —
  // because blocks are placed in Y-layer order, not material order. We
  // distribute the overall ratio uniformly across every block type as a
  // proxy. This will read close to correct once the build is well underway,
  // but early on it'll under/over-report some materials. Replacing this with
  // real per-type counts would require BuildCoordinator changes (out of
  // scope for this change).
  const rows = useMemo<MaterialRow[]>(() => {
    if (!palette) return [];
    const placedRatio =
      build && build.totalBlocks > 0
        ? Math.min((build.placedBlocks ?? 0) / build.totalBlocks, 1)
        : 0;
    return Object.entries(palette)
      .map<MaterialRow>(([blockName, total]) => {
        const placed = Math.round(total * placedRatio);
        const missing = Math.max(total - placed, 0);
        const pct = total > 0 ? Math.round((placed / total) * 100) : 0;
        return { blockName, total, placed, missing, pct };
      })
      .sort((a, b) => b.total - a.total);
  }, [palette, build]);

  const totalBlocks = useMemo(() => {
    if (!palette) return 0;
    return Object.values(palette).reduce((sum, n) => sum + n, 0);
  }, [palette]);

  const visibleRows = expanded ? rows : rows.slice(0, VISIBLE_ROWS);
  const overflow = Math.max(rows.length - VISIBLE_ROWS, 0);

  return (
    <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Materials</h3>
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-800/80 border border-zinc-700/40 text-zinc-300">
          {totalBlocks > 0 ? (
            <>
              {totalBlocks.toLocaleString()} total
              <span className="text-zinc-500">·</span>
              <span>{rows.length} type{rows.length !== 1 ? 's' : ''}</span>
            </>
          ) : (
            <span className="text-zinc-500">no palette</span>
          )}
        </span>
      </div>

      {loadingSchematic ? (
        <div className="py-6 text-center text-[11px] text-zinc-500">
          <div className="w-4 h-4 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-2" />
          Loading materials...
        </div>
      ) : !palette ? (
        <div className="py-4 text-center text-[11px] text-zinc-500">
          {schematicError
            ? `Failed to load schematic: ${schematicError}`
            : 'Material breakdown unavailable for this schematic'}
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {visibleRows.map((row) => {
              const state: 'untouched' | 'in-progress' | 'complete' =
                row.placed >= row.total
                  ? 'complete'
                  : row.placed > 0
                    ? 'in-progress'
                    : 'untouched';
              const colors = stateColor(state);
              return (
                <div
                  key={row.blockName}
                  className={`flex items-center gap-3 ${colors.bg} ${colors.border} border rounded-lg px-2 py-1.5`}
                >
                  <div className="shrink-0">
                    <Slot itemName={row.blockName} size={26} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-[11px] font-medium truncate ${colors.text}`}
                        title={row.blockName}
                      >
                        {formatItemName(row.blockName)}
                      </span>
                      <span className="text-[10px] tabular-nums text-zinc-400 shrink-0">
                        {row.placed.toLocaleString()} / {row.total.toLocaleString()}
                        <span className="text-zinc-600"> · </span>
                        <span className={state === 'complete' ? 'text-emerald-400' : 'text-zinc-500'}>
                          {row.missing.toLocaleString()} left
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-1 w-full bg-zinc-800/80 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-[width] duration-300"
                        style={{ width: `${row.pct}%`, backgroundColor: colors.bar }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {overflow > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="w-full text-[11px] text-teal-400 hover:text-teal-300 font-medium py-1"
            >
              {expanded ? 'Show fewer' : `+${overflow} more`}
            </button>
          )}

          <p className="text-[10px] text-zinc-600 leading-snug">
            Placed counts are estimated from overall build progress — the
            server tracks aggregate placement, not per-block-type counts.
          </p>
        </>
      )}
    </div>
  );
}

export default MaterialList;
