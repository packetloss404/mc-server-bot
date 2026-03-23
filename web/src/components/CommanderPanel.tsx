'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CommanderPlan } from '@/lib/api';

interface Props {
  plan: CommanderPlan;
  onExecute: () => void;
  onCancel: () => void;
  executing: boolean;
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.8 ? 'bg-emerald-500' : value >= 0.5 ? 'bg-amber-500' : 'bg-red-500';
  const textColor =
    value >= 0.8 ? 'text-emerald-400' : value >= 0.5 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
      <span className={`text-sm font-mono font-semibold ${textColor}`}>{pct}%</span>
    </div>
  );
}

export function CommanderPanel({ plan, onExecute, onCancel, executing }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const needsDoubleConfirm = plan.requiresConfirmation && !confirmed;

  const handleExecute = () => {
    if (needsDoubleConfirm) {
      setConfirmed(true);
      return;
    }
    onExecute();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-4"
    >
      {/* Intent */}
      <div>
        <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-1">
          Intent
        </h3>
        <p className="text-sm text-zinc-200">{plan.intent}</p>
      </div>

      {/* Confidence */}
      <div>
        <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
          Confidence
        </h3>
        <ConfidenceMeter value={plan.confidence} />
      </div>

      {/* Low confidence warning */}
      {plan.confidence < 0.5 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span className="text-sm text-red-300 font-medium">
            Low confidence -- review carefully before executing
          </span>
        </motion.div>
      )}

      {/* Warnings */}
      <AnimatePresence>
        {plan.warnings.length > 0 && (
          <div className="space-y-2">
            {plan.warnings.map((w, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-400 mt-0.5 shrink-0">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span className="text-xs text-amber-300">{w}</span>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* Commands */}
      {plan.commands.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Commands to Execute ({plan.commands.length})
          </h3>
          <div className="space-y-2">
            {plan.commands.map((cmd, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2.5"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-cyan-500/15 text-cyan-400 px-1.5 py-0.5 rounded">
                    {cmd.type}
                  </span>
                  {cmd.targets.length > 0 && (
                    <span className="text-xs text-zinc-400">
                      {cmd.targets.join(', ')}
                    </span>
                  )}
                </div>
                {Object.keys(cmd.payload).length > 0 && (
                  <pre className="text-[11px] text-zinc-500 font-mono mt-1 overflow-x-auto">
                    {JSON.stringify(cmd.payload, null, 2)}
                  </pre>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Missions */}
      {plan.missions.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">
            Missions to Create ({plan.missions.length})
          </h3>
          <div className="space-y-2">
            {plan.missions.map((m, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2.5"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-violet-500/15 text-violet-400 px-1.5 py-0.5 rounded">
                    {m.type}
                  </span>
                  <span className="text-sm text-zinc-200">{m.title}</span>
                </div>
                {m.assignees.length > 0 && (
                  <p className="text-xs text-zinc-500">
                    Assignees: {m.assignees.join(', ')}
                  </p>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-2 border-t border-zinc-800">
        <button
          onClick={handleExecute}
          disabled={executing}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
            needsDoubleConfirm
              ? 'bg-amber-600 hover:bg-amber-500 text-white'
              : 'bg-emerald-600 hover:bg-emerald-500 text-white'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {executing ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Executing...
            </>
          ) : needsDoubleConfirm ? (
            'Confirm Execute'
          ) : (
            'Execute'
          )}
        </button>
        <button
          onClick={onCancel}
          disabled={executing}
          className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}
