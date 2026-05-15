'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, type BotDetailed } from '@/lib/api';

interface Props {
  botName: string;
}

export function BotTabTasks({ botName }: Props) {
  const [bot, setBot] = useState<BotDetailed | null>(null);
  const [taskInput, setTaskInput] = useState('');
  const [sendingTask, setSendingTask] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [showFailed, setShowFailed] = useState(false);

  useEffect(() => {
    const load = () => {
      api
        .getBotDetailed(botName)
        .then((data) => setBot(data.bot))
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [botName]);

  const handleQueueTask = async () => {
    if (!taskInput.trim()) return;
    setSendingTask(true);
    try {
      await api.queueTask(botName, taskInput.trim());
      setTaskInput('');
    } catch {
      /* ignore */
    }
    setSendingTask(false);
  };

  const voyager = bot?.voyager;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
    >
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Task Queue</h2>

      <div className="flex gap-2 mb-3">
        <input
          value={taskInput}
          onChange={(e) => setTaskInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleQueueTask()}
          placeholder="Queue a task..."
          className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
        />
        <button
          onClick={handleQueueTask}
          disabled={sendingTask || !taskInput.trim()}
          className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        >
          Queue
        </button>
      </div>

      {voyager?.currentTask && (
        <div className="mb-3 p-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/15">
          <p className="text-[9px] text-emerald-500/70 uppercase tracking-wider mb-0.5">Current Task</p>
          <p className="text-xs text-zinc-200">{voyager.currentTask}</p>
        </div>
      )}

      {voyager ? (
        <>
          {voyager.completedTasks.length > 0 && (
            <div>
              <button
                onClick={() => setShowCompleted(!showCompleted)}
                className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-semibold uppercase hover:text-zinc-300 transition-colors mb-1"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform ${showCompleted ? 'rotate-90' : ''}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Completed ({voyager.completedTasks.length})
              </button>
              {showCompleted && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  className="space-y-0.5 ml-4 overflow-hidden"
                >
                  {voyager.completedTasks
                    .slice(-20)
                    .reverse()
                    .map((task, i) => (
                      <div key={i} className="text-xs text-zinc-400 truncate flex items-center gap-1.5">
                        <span className="text-emerald-500/60">&#10003;</span> {task}
                      </div>
                    ))}
                </motion.div>
              )}
            </div>
          )}
          {voyager.failedTasks.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setShowFailed(!showFailed)}
                className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-semibold uppercase hover:text-zinc-300 transition-colors mb-1"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className={`transition-transform ${showFailed ? 'rotate-90' : ''}`}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Failed ({voyager.failedTasks.length})
              </button>
              {showFailed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  className="space-y-0.5 ml-4 overflow-hidden"
                >
                  {voyager.failedTasks
                    .slice(-15)
                    .reverse()
                    .map((task, i) => (
                      <div key={i} className="text-xs text-red-400/60 truncate flex items-center gap-1.5">
                        <span className="text-red-500/60">&#10007;</span> {task}
                      </div>
                    ))}
                </motion.div>
              )}
            </div>
          )}
          {voyager.completedTasks.length === 0 && voyager.failedTasks.length === 0 && !voyager.currentTask && (
            <p className="text-xs text-zinc-600 text-center py-3">No tasks yet</p>
          )}
        </>
      ) : (
        <p className="text-xs text-zinc-600 text-center py-3">Voyager not active</p>
      )}
    </motion.div>
  );
}
