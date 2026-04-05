'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { api, type DiagnosticReport } from '@/lib/api';

interface Props {
  botName: string;
}

const STATUS_ICON: Record<string, { svg: React.ReactNode; color: string }> = {
  ok: {
    color: '#10B981',
    svg: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
      </svg>
    ),
  },
  warn: {
    color: '#F59E0B',
    svg: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  error: {
    color: '#EF4444',
    svg: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
};

const OVERALL_LABELS: Record<string, string> = {
  ok: 'All systems nominal',
  warn: 'Potential issues detected',
  error: 'Problems detected',
};

export function DiagnosticPanel({ botName }: Props) {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ id: string; msg: string; ok: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchDiagnostics = useCallback(() => {
    api.getBotDiagnostics(botName)
      .then((data) => { setReport(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [botName]);

  useEffect(() => {
    fetchDiagnostics();
    const interval = setInterval(fetchDiagnostics, 8000);
    return () => clearInterval(interval);
  }, [fetchDiagnostics]);

  const handleAction = async (actionId: string, endpoint: string, method: string) => {
    setActionLoading(actionId);
    setActionFeedback(null);
    try {
      const opts: RequestInit = { method };
      // For the unstuck action, send a task body
      if (actionId === 'run_unstuck') {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify({ description: 'Move to a safe position -- you seem stuck. Try jumping, moving away from obstacles, or pathfinding to a nearby open area.' });
      }
      const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${base}${endpoint}`, opts);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed (${res.status})`);
      }
      setActionFeedback({ id: actionId, msg: 'Action sent', ok: true });
      // Refresh diagnostics after action
      setTimeout(fetchDiagnostics, 2000);
    } catch (e: any) {
      setActionFeedback({ id: actionId, msg: e.message || 'Failed', ok: false });
    }
    setActionLoading(null);
    setTimeout(() => setActionFeedback(null), 4000);
  };

  if (loading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
      >
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Diagnostics</h2>
        <div className="flex items-center justify-center py-4">
          <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
        </div>
      </motion.div>
    );
  }

  if (!report) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
      >
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Diagnostics</h2>
        <p className="text-xs text-zinc-600 text-center py-3">Unable to load diagnostics</p>
      </motion.div>
    );
  }

  const overall = STATUS_ICON[report.overallStatus];
  const hasIssues = report.overallStatus !== 'ok';
  const errorCount = report.checks.filter((c) => c.status === 'error').length;
  const warnCount = report.checks.filter((c) => c.status === 'warn').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
    >
      {/* Header bar with overall status color */}
      <div
        className="h-0.5"
        style={{
          background: `linear-gradient(90deg, ${overall.color}, ${overall.color}40)`,
        }}
      />

      <div className="p-4">
        {/* Title row */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between group"
        >
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Diagnostics</h2>
            {/* Badge counts */}
            {errorCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                {errorCount} error{errorCount > 1 ? 's' : ''}
              </span>
            )}
            {warnCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                {warnCount} warning{warnCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              {overall.svg}
              <span className="text-[10px]" style={{ color: overall.color }}>
                {OVERALL_LABELS[report.overallStatus]}
              </span>
            </div>
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              className={`text-zinc-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </button>

        {/* Expanded checks */}
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="mt-3 space-y-1.5 overflow-hidden"
          >
            {report.checks.map((check) => {
              const icon = STATUS_ICON[check.status];
              return (
                <div
                  key={check.id}
                  className="flex items-start gap-2.5 px-2.5 py-2 rounded-lg"
                  style={{ backgroundColor: `${icon.color}06`, border: `1px solid ${icon.color}12` }}
                >
                  <div className="mt-0.5 shrink-0">{icon.svg}</div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-zinc-300">{check.label}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{check.detail}</div>
                  </div>
                </div>
              );
            })}

            {/* Recent failed tasks */}
            {report.raw.recentFailedTasks.length > 0 && (
              <div className="mt-2 pt-2 border-t border-zinc-800/40">
                <p className="text-[10px] text-zinc-600 font-semibold uppercase tracking-wider mb-1.5">
                  Recent Failed Tasks
                </p>
                <div className="space-y-0.5">
                  {report.raw.recentFailedTasks.map((task, i) => (
                    <div key={i} className="text-[11px] text-red-400/70 truncate flex items-center gap-1.5 pl-1">
                      <span className="text-red-500/50 shrink-0">&#10007;</span>
                      <span className="truncate">{task}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recovery actions */}
            {report.actions.length > 0 && (
              <div className="mt-3 pt-3 border-t border-zinc-800/40">
                <p className="text-[10px] text-zinc-600 font-semibold uppercase tracking-wider mb-2">
                  Recovery Actions
                </p>

                {/* Action feedback */}
                {actionFeedback && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`text-xs px-3 py-1.5 rounded-lg mb-2 ${
                      actionFeedback.ok
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}
                  >
                    {actionFeedback.msg}
                  </motion.div>
                )}

                <div className="flex flex-wrap gap-2">
                  {report.actions.map((action) => (
                    <button
                      key={action.id}
                      onClick={() => handleAction(action.id, action.endpoint, action.method)}
                      disabled={!action.available || actionLoading === action.id}
                      title={action.description}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                        !action.available
                          ? 'opacity-30 cursor-not-allowed'
                          : 'hover:brightness-110'
                      }`}
                      style={{
                        color: action.id === 'reconnect' ? '#EF4444' : '#3B82F6',
                        borderColor: action.id === 'reconnect' ? '#EF444425' : '#3B82F625',
                        backgroundColor: action.id === 'reconnect' ? '#EF444408' : '#3B82F608',
                      }}
                    >
                      {actionLoading === action.id ? (
                        <span className="w-3 h-3 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                      ) : (
                        <ActionIcon id={action.id} />
                      )}
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamp */}
            <div className="text-[9px] text-zinc-700 text-right pt-1">
              Last checked: {new Date(report.timestamp).toLocaleTimeString()}
            </div>
          </motion.div>
        )}

        {/* Collapsed: show summary row if there are issues */}
        {!expanded && hasIssues && (
          <div className="mt-2 flex flex-wrap gap-1">
            {report.checks
              .filter((c) => c.status !== 'ok')
              .slice(0, 3)
              .map((check) => {
                const icon = STATUS_ICON[check.status];
                return (
                  <span
                    key={check.id}
                    className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md"
                    style={{ color: icon.color, backgroundColor: `${icon.color}10` }}
                  >
                    {icon.svg}
                    {check.label}
                  </span>
                );
              })}
            {report.checks.filter((c) => c.status !== 'ok').length > 3 && (
              <span className="text-[10px] text-zinc-600 px-1 py-0.5">
                +{report.checks.filter((c) => c.status !== 'ok').length - 3} more
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function ActionIcon({ id }: { id: string }) {
  switch (id) {
    case 'resume_voyager':
      return <span className="text-[10px]">&#9654;</span>;
    case 'run_unstuck':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M1 4v6h6" />
          <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
        </svg>
      );
    case 'reconnect':
      return (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M23 4v6h-6" />
          <path d="M1 20v-6h6" />
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
        </svg>
      );
    default:
      return <span className="text-[10px]">*</span>;
  }
}
