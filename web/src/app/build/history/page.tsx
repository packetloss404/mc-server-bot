'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, BuildRecord } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';

type StatusFilter = 'all' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'pending';

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'paused', label: 'Paused' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
  { id: 'pending', label: 'Pending' },
];

const STATUS_COLORS: Record<string, string> = {
  pending: '#F59E0B',
  running: '#1ABC9C',
  paused: '#F59E0B',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#9CA3AF',
};

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#6B7280';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {status}
    </span>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
      <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}...` : id;
}

function formatTimestamp(ts: number | undefined): string {
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

interface BuildRecordExt extends BuildRecord {
  createdAt?: number;
  completedAt?: number;
  /** Build coordinator does not track completedAt natively, so the metadata
   *  blob may carry a finishedAt instead — we surface either. */
  metadata?: Record<string, any>;
}

export default function BuildHistoryPage() {
  const [builds, setBuilds] = useState<BuildRecordExt[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Initial load + 10s refresh (history can change as builds complete).
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.getBuilds()
        .then((data) => {
          if (!cancelled) setBuilds(data.builds as BuildRecordExt[]);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const t = setInterval(load, 10_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Debounce schematic search.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page when filters change.
  useEffect(() => {
    setPage(0);
  }, [statusFilter, debouncedSearch, dateFrom, dateTo]);

  const filtered = useMemo(() => {
    const fromTs = dateFrom ? Date.parse(dateFrom) : null;
    const toTs = dateTo ? Date.parse(dateTo) + 24 * 60 * 60 * 1000 : null;
    const q = debouncedSearch.trim().toLowerCase();
    return builds.filter((b) => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (q && !b.schematicFile.toLowerCase().includes(q)) return false;
      const created = b.createdAt ?? 0;
      if (fromTs !== null && created < fromTs) return false;
      if (toTs !== null && created > toTs) return false;
      return true;
    }).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [builds, statusFilter, debouncedSearch, dateFrom, dateTo]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageBuilds = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const activeBuild = drawerId ? builds.find((b) => b.id === drawerId) ?? null : null;
  const completedAt = (b: BuildRecordExt) =>
    b.completedAt ?? (b.metadata?.completedAt as number | undefined) ?? (b.metadata?.finishedAt as number | undefined);

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-6xl">
      <PageHeader title="Build History" subtitle={`${builds.length} build${builds.length === 1 ? '' : 's'} on record`} />

      {/* Filters */}
      <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                statusFilter === f.id
                  ? 'bg-teal-500/15 border border-teal-500/40 text-teal-300'
                  : 'bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600/60'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label htmlFor="bh-search" className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">
              Schematic
            </label>
            <input
              id="bh-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. house, tower"
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-teal-500/40"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="bh-from" className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">
              From
            </label>
            <input
              id="bh-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="bh-to" className="text-[10px] text-zinc-500 uppercase font-semibold tracking-wider">
              To
            </label>
            <input
              id="bh-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white"
            />
          </div>
        </div>
        {(search || dateFrom || dateTo || statusFilter !== 'all') && (
          <button
            onClick={() => {
              setSearch('');
              setDateFrom('');
              setDateTo('');
              setStatusFilter('all');
            }}
            className="text-[11px] text-teal-400 hover:text-teal-300 font-medium"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-12 text-center">
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs text-zinc-500">Loading builds...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-zinc-500">No builds match the current filters.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-950/40 text-zinc-500 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-semibold">ID</th>
                  <th className="text-left px-4 py-2 font-semibold">Schematic</th>
                  <th className="text-left px-4 py-2 font-semibold">Origin</th>
                  <th className="text-left px-4 py-2 font-semibold">Status</th>
                  <th className="text-left px-4 py-2 font-semibold w-44">Progress</th>
                  <th className="text-left px-4 py-2 font-semibold">Created</th>
                  <th className="text-left px-4 py-2 font-semibold">Completed</th>
                </tr>
              </thead>
              <tbody>
                {pageBuilds.map((b) => {
                  const placed = b.placedBlocks ?? 0;
                  const total = b.totalBlocks ?? 0;
                  const pct = total > 0 ? Math.round((placed / total) * 100) : 0;
                  return (
                    <tr
                      key={b.id}
                      onClick={() => setDrawerId(b.id)}
                      className="border-t border-zinc-800/60 hover:bg-zinc-800/30 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-2 font-mono text-zinc-400">{shortId(b.id)}</td>
                      <td className="px-4 py-2 text-zinc-200 max-w-[220px] truncate" title={b.schematicFile}>
                        {b.schematicFile.replace(/\.(schem|schematic)$/i, '')}
                      </td>
                      <td className="px-4 py-2 text-zinc-400 font-mono">
                        {b.origin ? `${b.origin.x}, ${b.origin.y}, ${b.origin.z}` : '-'}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="px-4 py-2">
                        <div className="space-y-1">
                          <ProgressBar value={placed} max={total} />
                          <p className="text-[10px] text-zinc-500">
                            {placed.toLocaleString()} / {total.toLocaleString()} ({pct}%)
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-zinc-400">{formatTimestamp(b.createdAt)}</td>
                      <td className="px-4 py-2 text-zinc-400">{formatTimestamp(completedAt(b))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-800/60 px-4 py-2 text-xs text-zinc-500">
            <span>
              Page {page + 1} of {totalPages} ({filtered.length} builds)
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2.5 py-1 rounded-md bg-zinc-800/80 border border-zinc-700/40 text-zinc-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="px-2.5 py-1 rounded-md bg-zinc-800/80 border border-zinc-700/40 text-zinc-300 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      <AnimatePresence>
        {activeBuild && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40 flex justify-end"
            onClick={() => setDrawerId(null)}
          >
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full sm:w-[460px] h-full bg-zinc-950 border-l border-zinc-800/60 overflow-y-auto"
            >
              <div className="p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-white">{activeBuild.schematicFile.replace(/\.(schem|schematic)$/i, '')}</h2>
                    <p className="text-[11px] text-zinc-500 font-mono mt-0.5">{activeBuild.id}</p>
                  </div>
                  <button
                    onClick={() => setDrawerId(null)}
                    className="text-zinc-500 hover:text-white transition-colors"
                    aria-label="Close drawer"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-3">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Status</p>
                    <StatusBadge status={activeBuild.status} />
                  </div>
                  <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-3">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Origin</p>
                    <p className="text-zinc-300 font-mono">
                      {activeBuild.origin
                        ? `${activeBuild.origin.x}, ${activeBuild.origin.y}, ${activeBuild.origin.z}`
                        : '-'}
                    </p>
                  </div>
                  <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-3">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Created</p>
                    <p className="text-zinc-300">{formatTimestamp(activeBuild.createdAt)}</p>
                  </div>
                  <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-3">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Completed</p>
                    <p className="text-zinc-300">{formatTimestamp(completedAt(activeBuild))}</p>
                  </div>
                </div>

                <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-3 space-y-2">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Progress</p>
                  <ProgressBar value={activeBuild.placedBlocks ?? 0} max={activeBuild.totalBlocks ?? 0} />
                  <p className="text-[11px] text-zinc-400">
                    {(activeBuild.placedBlocks ?? 0).toLocaleString()} / {(activeBuild.totalBlocks ?? 0).toLocaleString()} blocks
                  </p>
                </div>

                {/* Assignments */}
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">Assignments</p>
                  {(activeBuild.assignments ?? []).length === 0 ? (
                    <p className="text-xs text-zinc-600">No bot assignments recorded.</p>
                  ) : (
                    <div className="space-y-2">
                      {(activeBuild.assignments ?? []).map((a) => {
                        const placed = a.blocksPlaced ?? 0;
                        const total = a.blocksTotal ?? 0;
                        return (
                          <div
                            key={a.botName}
                            className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-3 space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-white font-medium">{a.botName}</span>
                              <StatusBadge status={a.status} />
                            </div>
                            <p className="text-[11px] text-zinc-500">
                              Y {a.yMin}-{a.yMax} {a.currentY != null && (
                                <span className="text-zinc-600">| current Y={a.currentY}</span>
                              )}
                            </p>
                            <ProgressBar value={placed} max={total} />
                            <p className="text-[10px] text-zinc-500 text-right">
                              {placed.toLocaleString()} / {total.toLocaleString()}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Errors / metadata */}
                {activeBuild.metadata && Object.keys(activeBuild.metadata).length > 0 && (
                  <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-3 space-y-1.5">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Metadata</p>
                    <pre className="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap break-words">
                      {JSON.stringify(activeBuild.metadata, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Schematic preview link */}
                <a
                  href={`/build?schematic=${encodeURIComponent(activeBuild.schematicFile)}`}
                  className="block text-center px-3 py-2 rounded-lg bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 hover:text-white hover:border-teal-500/40 text-xs font-medium transition-colors"
                >
                  Open in Builder &rarr;
                </a>
              </div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
