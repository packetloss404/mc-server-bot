'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';

interface Props {
  botName: string;
  currentTask: string | null;
  queuedTasks: string[];
  isRunning: boolean;
  onRefresh?: () => void;
}

export function MissionQueuePanel({ botName, currentTask, queuedTasks, isRunning, onRefresh }: Props) {
  const [taskInput, setTaskInput] = useState('');
  const [prepend, setPrepend] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);

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

  const getItemLabel = (index: number): { text: string; color: string } => {
    if (index === 0) {
      return { text: 'Do now', color: '#F59E0B' };
    }
    if (index === 1) {
      return { text: 'Do next', color: '#3B82F6' };
    }
    return { text: `#${index + 1}`, color: '#6B7280' };
  };

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
        !currentTask && (
          <p className="text-xs text-zinc-600 text-center py-3">No tasks queued</p>
        )
      )}
    </motion.div>
  );
}
