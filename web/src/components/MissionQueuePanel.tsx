'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { api, type MissionRecord } from '@/lib/api';
import Link from 'next/link';

interface Props {
  botName: string;
  currentTask: string | null;
  queuedTasks: string[];
  isRunning: boolean;
  /** Recently failed missions for this bot (from control platform) */
  failedMissions?: MissionRecord[];
  onRefresh?: () => void;
}

// ---------------------------------------------------------------------------
// Recovery suggestion engine
// ---------------------------------------------------------------------------

interface RecoverySuggestion {
  icon: string;
  title: string;
  description: string;
  action?: { label: string; handler: () => Promise<void> };
  diagnosticHint?: boolean;
}

function getRecoverySuggestions(
  mission: MissionRecord,
  botName: string,
): RecoverySuggestion[] {
  const error = (mission.error || mission.blockedReason || '').toLowerCase();
  const suggestions: RecoverySuggestion[] = [];

  if (error.includes('bot not found') || error.includes('disconnect') || error.includes('not connected')) {
    suggestions.push({
      icon: 'plug',
      title: 'Bot may have disconnected',
      description: 'Reconnect the bot and retry the mission.',
      diagnosticHint: true,
    });
  }

  if (error.includes('task failed') || error.includes('execution failed') || error.includes('code error')) {
    suggestions.push({
      icon: 'wrench',
      title: 'Task execution failed',
      description: 'Run unstuck command first, then retry.',
      action: {
        label: 'Run Unstuck',
        handler: () => api.queueTask(botName, 'Move to a safe position -- you seem stuck. Try jumping, moving away from obstacles, or pathfinding to a nearby open area.').then(() => {}),
      },
    });
  }

  if (error.includes('stale') || error.includes('timeout') || error.includes('timed out')) {
    suggestions.push({
      icon: 'clock',
      title: 'Mission may be stuck',
      description: 'Cancel this stale mission and create a new one with the same parameters.',
      action: {
        label: 'Cancel Mission',
        handler: () => api.cancelMission(mission.id).then(() => {}),
      },
    });
  }

  if (error.includes('path') || error.includes('navigate') || error.includes('unreachable')) {
    suggestions.push({
      icon: 'map',
      title: 'Navigation failed',
      description: 'The bot could not reach the target. Try moving the bot closer first.',
    });
  }

  if (error.includes('inventory') || error.includes('no space') || error.includes('full')) {
    suggestions.push({
      icon: 'box',
      title: 'Inventory issue',
      description: 'The bot may need to deposit items before retrying.',
    });
  }

  // Fallback suggestion if no specific match
  if (suggestions.length === 0) {
    suggestions.push({
      icon: 'info',
      title: 'Mission failed',
      description: 'Check diagnostics for more details on what went wrong.',
      diagnosticHint: true,
    });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Icon helper
// ---------------------------------------------------------------------------

function SuggestionIcon({ type }: { type: string }) {
  switch (type) {
    case 'plug':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22v-5" /><path d="M9 7V2" /><path d="M15 7V2" /><path d="M6 13V8h12v5a4 4 0 01-4 4h-4a4 4 0 01-4-4z" />
        </svg>
      );
    case 'wrench':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
        </svg>
      );
    case 'clock':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case 'map':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" />
        </svg>
      );
    case 'box':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0022 16z" />
        </svg>
      );
    default:
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
      );
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MissionQueuePanel({
  botName,
  currentTask,
  queuedTasks,
  isRunning,
  failedMissions = [],
  onRefresh,
}: Props) {
  const [taskInput, setTaskInput] = useState('');
  const [prepend, setPrepend] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const showFeedback = (msg: string, ok: boolean) => {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 3000);
  };

  const handleQueueTask = async () => {
    if (!taskInput.trim()) return;
    setSending(true);
    try {
      await api.queueTask(botName, taskInput.trim(), prepend);
      setTaskInput('');
      showFeedback(prepend ? 'Task added to front' : 'Task queued', true);
      onRefresh?.();
    } catch (e: any) {
      showFeedback(e.message || 'Failed to queue task', false);
    }
    setSending(false);
  };

  const handleMoveUp = async (index: number) => {
    if (index <= 0) return;
    const newOrder = [...queuedTasks];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    try {
      await api.reorderBotMissionQueue(botName, newOrder);
      onRefresh?.();
    } catch (e: any) {
      showFeedback(e.message || 'Reorder failed', false);
    }
  };

  const handleMoveDown = async (index: number) => {
    if (index >= queuedTasks.length - 1) return;
    const newOrder = [...queuedTasks];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    try {
      await api.reorderBotMissionQueue(botName, newOrder);
      onRefresh?.();
    } catch (e: any) {
      showFeedback(e.message || 'Reorder failed', false);
    }
  };

  const handleClearQueue = async () => {
    try {
      await api.clearBotMissionQueue(botName);
      showFeedback('Queue cleared', true);
      onRefresh?.();
    } catch (e: any) {
      showFeedback(e.message || 'Failed to clear queue', false);
    }
  };

  const handleRetryMission = async (missionId: string) => {
    setRetryingId(missionId);
    try {
      await api.retryMission(missionId);
      showFeedback('Mission retried', true);
      onRefresh?.();
    } catch (e: any) {
      showFeedback(e.message || 'Retry failed', false);
    }
    setRetryingId(null);
  };

  const handleSuggestionAction = async (missionId: string, handler: () => Promise<void>) => {
    setActionLoadingId(missionId);
    try {
      await handler();
      showFeedback('Action completed', true);
      onRefresh?.();
    } catch (e: any) {
      showFeedback(e.message || 'Action failed', false);
    }
    setActionLoadingId(null);
  };

  const getItemLabel = (index: number): { text: string; color: string } => {
    if (index === 0) return { text: 'Do now', color: '#F59E0B' };
    if (index === 1) return { text: 'Do next', color: '#3B82F6' };
    return { text: `#${index + 1}`, color: '#6B7280' };
  };

  // Only show the most recent few failed missions
  const recentFailed = failedMissions.slice(0, 3);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Task Queue</h2>
        {queuedTasks.length > 0 && (
          <button
            onClick={handleClearQueue}
            className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors px-2 py-0.5 rounded hover:bg-red-500/10"
          >
            Clear Queue
          </button>
        )}
      </div>

      {/* Feedback */}
      {feedback && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className={`text-xs px-3 py-1.5 rounded-lg mb-3 ${
            feedback.ok
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          }`}
        >
          {feedback.msg}
        </motion.div>
      )}

      {/* Add task input */}
      <div className="space-y-2 mb-3">
        <div className="flex gap-2">
          <input
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleQueueTask()}
            placeholder="Queue a task..."
            className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
          />
          <button
            onClick={handleQueueTask}
            disabled={sending || !taskInput.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >
            Queue
          </button>
        </div>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <button
            onClick={() => setPrepend(!prepend)}
            className={`w-8 h-4 rounded-full transition-colors relative ${
              prepend ? 'bg-amber-500/60' : 'bg-zinc-700'
            }`}
          >
            <span
              className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                prepend ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>
          <span className="text-[10px] text-zinc-500">
            {prepend ? 'Add to front (do next)' : 'Add to back (do last)'}
          </span>
        </label>
      </div>

      {/* Current task */}
      {currentTask && (
        <div className="mb-2">
          <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
            <span className="shrink-0">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            </span>
            <span className="text-[10px] font-medium text-emerald-400/80 uppercase shrink-0">
              Running
            </span>
            <span className="text-xs text-zinc-300 truncate flex-1">{currentTask}</span>
          </div>
        </div>
      )}

      {/* Queued tasks */}
      {queuedTasks.length > 0 ? (
        <div className="space-y-1">
          {queuedTasks.map((task, index) => {
            const label = getItemLabel(index);
            return (
              <div
                key={`${task}-${index}`}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-800/40 border border-zinc-800/60 group"
              >
                <span
                  className="text-[10px] font-medium shrink-0 w-14 text-right"
                  style={{ color: label.color }}
                >
                  {label.text}
                </span>
                <span className="text-xs text-zinc-400 truncate flex-1">{task}</span>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    className="p-0.5 rounded hover:bg-zinc-700 disabled:opacity-20 disabled:cursor-not-allowed text-zinc-500 hover:text-zinc-300 transition-colors"
                    title="Move up"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="18 15 12 9 6 15" />
                    </svg>
                  </button>
                  <button
                    onClick={() => handleMoveDown(index)}
                    disabled={index === queuedTasks.length - 1}
                    className="p-0.5 rounded hover:bg-zinc-700 disabled:opacity-20 disabled:cursor-not-allowed text-zinc-500 hover:text-zinc-300 transition-colors"
                    title="Move down"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        !currentTask && recentFailed.length === 0 && (
          <p className="text-xs text-zinc-600 text-center py-3">No tasks queued</p>
        )
      )}

      {/* Failed missions with retry + recovery suggestions */}
      {recentFailed.length > 0 && (
        <div className="mt-3 pt-3 border-t border-zinc-800/40">
          <p className="text-[10px] text-red-400/80 font-semibold uppercase tracking-wider mb-2">
            Failed Missions
          </p>
          <div className="space-y-2">
            {recentFailed.map((mission) => {
              const suggestions = getRecoverySuggestions(mission, botName);
              const isRetrying = retryingId === mission.id;

              return (
                <div
                  key={mission.id}
                  className="rounded-lg border border-red-500/15 bg-red-500/5 overflow-hidden"
                >
                  {/* Mission header */}
                  <div className="flex items-center gap-2 px-2.5 py-2">
                    <span className="text-red-500/60 shrink-0">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                    </span>
                    <span className="text-xs text-zinc-300 truncate flex-1">
                      {mission.description || mission.title || `${mission.type} mission`}
                    </span>
                    {mission.retryCount != null && mission.retryCount > 0 && (
                      <span className="text-[9px] text-zinc-600 shrink-0">
                        retried {mission.retryCount}x
                      </span>
                    )}
                    <button
                      onClick={() => handleRetryMission(mission.id)}
                      disabled={isRetrying}
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 transition-colors disabled:opacity-50 shrink-0"
                    >
                      {isRetrying ? (
                        <span className="w-3 h-3 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
                      ) : (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M1 4v6h6" />
                          <path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
                        </svg>
                      )}
                      Retry
                    </button>
                  </div>

                  {/* Error message */}
                  {(mission.error || mission.blockedReason) && (
                    <div className="px-2.5 pb-1.5">
                      <p className="text-[10px] text-red-400/70 truncate">
                        {mission.error || mission.blockedReason}
                      </p>
                    </div>
                  )}

                  {/* Recovery suggestion cards */}
                  <div className="px-2.5 pb-2.5 space-y-1.5">
                    {suggestions.map((suggestion, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-zinc-800/60 border border-zinc-700/30"
                      >
                        <span className="text-amber-400/70 mt-0.5 shrink-0">
                          <SuggestionIcon type={suggestion.icon} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-medium text-zinc-300">
                            {suggestion.title}
                          </p>
                          <p className="text-[10px] text-zinc-500 leading-relaxed">
                            {suggestion.description}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {suggestion.action && (
                              <button
                                onClick={() =>
                                  handleSuggestionAction(
                                    `${mission.id}-${idx}`,
                                    suggestion.action!.handler,
                                  )
                                }
                                disabled={actionLoadingId === `${mission.id}-${idx}`}
                                className="text-[10px] font-medium text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                              >
                                {actionLoadingId === `${mission.id}-${idx}` ? 'Running...' : suggestion.action.label}
                              </button>
                            )}
                            {suggestion.diagnosticHint && (
                              <span className="text-[10px] text-zinc-600">
                                See Diagnostics panel below for details
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}
