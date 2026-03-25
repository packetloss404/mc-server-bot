'use client';

import { useState, useRef, useCallback, type KeyboardEvent } from 'react';
import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, type CommanderPlan, type CommanderResult } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { CommanderPanel } from '@/components/CommanderPanel';
import { useControlStore, useMissionStore } from '@/lib/store';

const EXAMPLE_PROMPTS = [
  'Send all guards to the village',
  'Have Ada mine 3 iron ore',
  'Pause every bot except builders',
  'Move the miners to the mine marker',
];

const DRAFT_KEY = 'commander-draft';

interface HistoryEntry {
  input: string;
  plan: CommanderPlan;
  result?: CommanderResult | null;
  timestamp: number;
}

export default function CommanderPage() {
  const recentCommands = useControlStore((s) => s.commandHistory.filter((command) => command.source === 'commander').slice(0, 5));
  const recentMissions = useMissionStore((s) => s.missions.filter((mission) => mission.source === 'commander').slice(0, 5));
  const [input, setInput] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem(DRAFT_KEY) ?? '';
  });
  const [parsing, setParsing] = useState(false);
  const [plan, setPlan] = useState<CommanderPlan | null>(null);
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<CommanderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getCommanderHistory({ limit: 20 }).then((data) => {
      if (cancelled) return;
      setHistory(data.entries.map((entry) => ({
        input: entry.input,
        plan: entry.plan,
        result: entry.result ?? null,
        timestamp: entry.executedAt ? Date.parse(entry.executedAt) : Date.parse(entry.createdAt),
      })));
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(DRAFT_KEY, input);
  }, [input]);

  const handleParse = useCallback(async () => {
    if (!input.trim() || parsing) return;
    setParsing(true);
    setError(null);
    setPlan(null);
    setResult(null);
    try {
      const data = await api.parseCommanderInput(input.trim());
      setPlan(data.plan);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to parse command');
    }
    setParsing(false);
  }, [input, parsing]);

  const handleExecute = useCallback(async () => {
    if (!plan || executing) return;
    setExecuting(true);
    setError(null);
    try {
      const data = await api.executeCommanderPlan(plan.id);
      setResult(data.result);
      setHistory((prev) => [
        { input, plan, result: data.result, timestamp: Date.now() },
        ...prev,
      ]);
      api.getCommanderHistory({ limit: 20 }).then((historyData) => {
        setHistory(historyData.entries.map((entry) => ({
          input: entry.input,
          plan: entry.plan,
          result: entry.result ?? null,
          timestamp: entry.executedAt ? Date.parse(entry.executedAt) : Date.parse(entry.createdAt),
        })));
      }).catch(() => {});
      setPlan(null);
      setInput('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Execution failed');
    }
    setExecuting(false);
  }, [plan, executing, input]);

  const handleCancel = useCallback(() => {
    setPlan(null);
    setResult(null);
    setError(null);
  }, []);

  const handleEditRetry = useCallback(() => {
    setPlan(null);
    setResult(null);
    setError(null);
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleParse();
    }
  };

  const handleExampleClick = (prompt: string) => {
    setInput(prompt);
    setPlan(null);
    setResult(null);
    setError(null);
    textareaRef.current?.focus();
  };

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  const restoreHistoryEntry = (entry: HistoryEntry) => {
    setInput(entry.input);
    setPlan(entry.plan);
    setResult(entry.result ?? null);
    setError(null);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        autoGrow(textareaRef.current);
      }
    });
  };

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-4xl">
      <PageHeader
        title="Commander"
        subtitle="Natural language control for your bot fleet"
      />

      {/* Input area */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-3">
        <div className="relative">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Tell your bots what to do..."
            rows={2}
            className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-zinc-600">
            Press <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 font-mono text-[10px]">Ctrl+Enter</kbd> to parse
          </span>
          <button
            onClick={handleParse}
            disabled={!input.trim() || parsing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {parsing ? (
              <>
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Parsing...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 10 4 15 9 20" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
                Parse
              </>
            )}
          </button>
        </div>

        {/* Example prompts */}
        <AnimatePresence>
          {!input.trim() && !plan && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <p className="text-[11px] text-zinc-600 mb-2">Try an example:</p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLE_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleExampleClick(prompt)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400 shrink-0">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            <span className="text-sm text-red-300">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400 hover:text-red-300"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Plan preview */}
      <AnimatePresence mode="wait">
        {plan && (
          <div className="space-y-3">
            <CommanderPanel
              plan={plan}
              onExecute={handleExecute}
              onCancel={handleCancel}
              executing={executing}
            />
            {!executing && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={handleEditRetry}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Edit &amp; Retry
              </motion.button>
            )}
          </div>
        )}
      </AnimatePresence>

      {/* Execution result */}
      <AnimatePresence>
        {result && !plan && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-3"
          >
            <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
              Execution Results
            </h3>
            {result.commandResults.length > 0 && (
              <div className="space-y-1.5">
                {result.commandResults.map((cr, i) => (
                  <div
                    key={i}
                    className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
                      cr.success
                        ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                        : 'bg-red-500/10 border border-red-500/20 text-red-300'
                    }`}
                  >
                    {cr.success ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    )}
                    <span className="font-mono">{cr.command.type}</span>
                    <span className="text-zinc-500">{cr.command.targets.join(', ')}</span>
                    {cr.command.status && <span className="text-zinc-500">{cr.command.status}</span>}
                    {cr.error && <span className="ml-auto text-red-400">{cr.error}</span>}
                  </div>
                ))}
              </div>
            )}
            {result.missionsCreated.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs text-zinc-400">
                  Missions created: {result.missionsCreated.length}
                </p>
                {result.missionsCreated.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    <span>{m.title}</span>
                    <span className="text-zinc-500">{m.assigneeIds.join(', ')}</span>
                    {m.status && <span className="text-zinc-500">{m.status}</span>}
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setResult(null)}
              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Execution history */}
      {history.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
            Execution History
          </h2>
          <div className="space-y-2">
            {history.map((entry, i) => {
              const expanded = expandedHistory === i;
              const succeeded = entry.result?.commandResults.filter((c) => c.success).length ?? 0;
              const failed = entry.result?.commandResults.filter((c) => !c.success).length ?? 0;
              const missions = entry.result?.missionsCreated.length ?? 0;

              return (
                <motion.div
                  key={`${entry.timestamp}-${i}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedHistory(expanded ? null : i)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/30 transition-colors"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className={`text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <span className="text-sm text-zinc-300 truncate flex-1">
                      {entry.input.length > 80
                        ? entry.input.slice(0, 80) + '...'
                        : entry.input}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {succeeded > 0 && (
                        <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                          {succeeded} ok
                        </span>
                      )}
                      {failed > 0 && (
                        <span className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                          {failed} failed
                        </span>
                      )}
                      {missions > 0 && (
                        <span className="text-[10px] text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded">
                          {missions} mission{missions !== 1 ? 's' : ''}
                        </span>
                      )}
                      <span className="text-[10px] text-zinc-600 font-mono">
                        {new Date(entry.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </button>

                  <AnimatePresence>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t border-zinc-800/50"
                      >
                        <div className="px-4 py-3 space-y-3">
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Intent</p>
                            <p className="text-xs text-zinc-400">{entry.plan.parsedIntent}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-zinc-600 mb-1">Confidence</p>
                            <p className="text-xs text-zinc-400">
                              {Math.round(entry.plan.confidence * 100)}%
                            </p>
                          </div>
                          {entry.result && entry.result.commandResults.length > 0 && (
                            <div>
                              <p className="text-[10px] text-zinc-600 mb-1">Commands</p>
                              {entry.result.commandResults.map((cr, j) => (
                                <div key={j} className="flex items-center gap-2 text-xs text-zinc-400">
                                  <span className={cr.success ? 'text-emerald-400' : 'text-red-400'}>
                                    {cr.success ? 'OK' : 'FAIL'}
                                  </span>
                                  <span className="font-mono">{cr.command.type}</span>
                                  <span>{cr.command.targets.join(', ')}</span>
                                  {cr.command.status && <span className="text-zinc-600">[{cr.command.status}]</span>}
                                  {cr.error && (
                                    <span className="text-red-400/70">({cr.error})</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                          {entry.result && entry.result.missionsCreated.length > 0 && (
                            <div>
                              <p className="text-[10px] text-zinc-600 mb-1">Missions</p>
                              {entry.result.missionsCreated.map((m, j) => (
                                <div key={j} className="text-xs text-zinc-400">
                                  {m.title} ({m.assigneeIds.join(', ')}){m.status ? ` [${m.status}]` : ''}
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/50">
                            <button
                              onClick={() => restoreHistoryEntry(entry)}
                              className="text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors"
                            >
                              Restore to editor
                            </button>
                            <button
                              onClick={() => handleExampleClick(entry.input)}
                              className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                            >
                              Reuse input only
                            </button>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {(recentCommands.length > 0 || recentMissions.length > 0) && (
        <div className="space-y-3">
          <h2 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
            Shared Control Activity
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-4 space-y-2">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Recent Commands</p>
              {recentCommands.map((command) => (
                <div key={command.id} className="text-xs text-zinc-300 flex items-center justify-between gap-2">
                  <span className="truncate">{command.type} - {command.targets.join(', ')}</span>
                  <span className="text-zinc-500">{command.status}</span>
                </div>
              ))}
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg p-4 space-y-2">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider">Recent Missions</p>
              {recentMissions.map((mission) => (
                <div key={mission.id} className="text-xs text-zinc-300 flex items-center justify-between gap-2">
                  <span className="truncate">{mission.title}</span>
                  <span className="text-zinc-500">{mission.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
