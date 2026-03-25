'use client';

import { motion } from 'framer-motion';
import { STATE_COLORS, STATE_LABELS } from '@/lib/constants';

interface VoyagerState {
  isRunning: boolean;
  isPaused: boolean;
  currentTask: string | null;
  internalState?: string;
  queuedTaskCount?: number;
  completedTasks: string[];
  failedTasks: string[];
}

interface CombatState {
  lastAttackerName: string | null;
  lastAttackedAt: number;
  instinctActive: boolean;
}

interface Props {
  state: string;
  voyager: VoyagerState | null;
  combat?: CombatState;
  health?: number;
  accentColor: string;
}

export function BotActivityPanel({ state, voyager, combat, health }: Props) {
  const stateColor = STATE_COLORS[state] ?? '#6B7280';
  const stateLabel = STATE_LABELS[state] ?? state;
  const isActive = !['IDLE', 'DISCONNECTED', 'SPAWNING'].includes(state);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
    >
      {/* State banner */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ backgroundColor: `${stateColor}08`, borderBottom: `1px solid ${stateColor}20` }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className={`w-2.5 h-2.5 rounded-full ${isActive ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: stateColor }}
          />
          <span className="text-sm font-semibold" style={{ color: stateColor }}>
            {stateLabel}
          </span>
        </div>
        {voyager && (
          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
            {voyager.isRunning && !voyager.isPaused && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Running
              </span>
            )}
            {voyager.isPaused && (
              <span className="flex items-center gap-1 text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Paused
              </span>
            )}
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Combat alert */}
        {combat?.instinctActive && (
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 flex items-center gap-2"
          >
            <span className="text-red-400 text-sm font-bold animate-pulse">!</span>
            <div>
              <p className="text-xs text-red-400 font-medium">
                Under attack{combat.lastAttackerName ? ` by ${combat.lastAttackerName}` : ''}
              </p>
              {health !== undefined && (
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden w-24">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${(health / 20) * 100}%`, backgroundColor: health > 10 ? '#EF4444' : '#DC2626' }}
                    />
                  </div>
                  <span className="text-[10px] text-red-400 tabular-nums">{health}/20</span>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Current task */}
        {voyager?.currentTask && (
          <div className="flex items-start gap-2.5">
            <div className="w-5 h-5 rounded-md bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Current Task</p>
              <p className="text-sm text-white mt-0.5">{voyager.currentTask}</p>
            </div>
          </div>
        )}

        {/* Queued tasks */}
        {voyager && (voyager.queuedTaskCount ?? 0) > 0 && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            <span>{voyager.queuedTaskCount} task{voyager.queuedTaskCount !== 1 ? 's' : ''} queued</span>
          </div>
        )}

        {/* State description for non-task states */}
        {!voyager?.currentTask && !combat?.instinctActive && (
          <p className="text-xs text-zinc-500">
            {state === 'IDLE' && 'Idle — waiting for tasks or exploring'}
            {state === 'WANDERING' && 'Wandering and exploring the area'}
            {state === 'FOLLOWING' && 'Following a nearby player'}
            {state === 'MINING' && 'Mining blocks'}
            {state === 'PATROLLING' && 'Patrolling the area'}
            {state === 'DISCONNECTED' && 'Bot is offline'}
            {state === 'SPAWNING' && 'Spawning into the world...'}
          </p>
        )}

        {/* Voyager summary */}
        {voyager && (voyager.completedTasks.length > 0 || voyager.failedTasks.length > 0) && (
          <div className="flex items-center gap-4 text-[10px] text-zinc-600 pt-2 border-t border-zinc-800/40">
            <span className="flex items-center gap-1">
              <span className="text-emerald-500">&#10003;</span>
              {voyager.completedTasks.length} completed
            </span>
            {voyager.failedTasks.length > 0 && (
              <span className="flex items-center gap-1">
                <span className="text-red-400">&#10007;</span>
                {voyager.failedTasks.length} failed
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
