'use client';

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from 'react';
import { api, type CommanderPlan, type CommanderResult, type CommanderDraft } from '@/lib/api';
import { CommanderPanel } from '@/components/CommanderPanel';

const FALLBACK_PROMPTS = [
  'Send all guards to the village',
  'Have Ada mine 3 iron ore',
  'Pause every bot except builders',
  'Move the miners to the mine marker',
];

interface HistoryEntry {
  input: string;
  plan: CommanderPlan;
  result?: CommanderResult | null;
  timestamp: number;
}

export default function CommanderPage() {
  const [input, setInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [plan, setPlan] = useState<CommanderPlan | null>(null);
  const [executing, setExecuting] = useState(false);
  const [clarifying, setClarifying] = useState(false);
  const [result, setResult] = useState<CommanderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [drafts, setDrafts] = useState<CommanderDraft[]>([]);
  const [expandedHistory, setExpandedHistory] = useState<number | null>(null);
  const [suggestedCommands, setSuggestedCommands] = useState<string[]>(FALLBACK_PROMPTS);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load history, drafts, and suggestions on mount
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
    void api.getCommanderDrafts().then((data) => {
      if (cancelled) return;
      setDrafts(data.drafts);
    }).catch(() => {});
    void api.getCommanderSuggestions().then((data) => {
      if (cancelled) return;
      if (data.suggestions.length > 0) {
        setSuggestedCommands(data.suggestions);
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Save draft to API
  const saveDraftToApi = useCallback(async (text: string) => {
    if (!text.trim()) return;
    try {
      const { draft } = await api.saveCommanderDraft({ input: text.trim() });
      setDrafts((prev) => {
        const exists = prev.findIndex((d) => d.id === draft.id);
        if (exists >= 0) {
          const updated = [...prev];
          updated[exists] = draft;
          return updated;
        }
        return [...prev, draft];
      });
    } catch {
      // Silently fail draft save
    }
  }, []);

  const deleteDraft = useCallback(async (id: string) => {
    try {
      await api.deleteCommanderDraft(id);
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch {
      // Silently fail
    }
  }, []);

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

  const handleClarify = useCallback(async (clarifications: Record<string, string>) => {
    if (!plan || clarifying) return;
    setClarifying(true);
    setError(null);
    try {
      const data = await api.clarifyCommanderInput(plan.input, clarifications);
      setPlan(data.plan);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to process clarification');
    }
    setClarifying(false);
  }, [plan, clarifying]);

  const handleExecute = useCallback(async () => {
    if (!plan || executing) return;
    setExecuting(true);
    setError(null);
    try {
      const data = await api.executeCommanderPlan(plan.id);
      setResult(data.result);
      // Refresh history from API
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
  }, [plan, executing]);

  const handleCancel = useCallback(() => {
    setPlan(null);
    setResult(null);
    setError(null);
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

  const restoreDraft = (draft: CommanderDraft) => {
    setInput(draft.input);
    if (draft.plan) setPlan(draft.plan);
    setResult(null);
    setError(null);
    textareaRef.current?.focus();
  };

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Commander</h1>
        <p className="text-sm text-zinc-500 mt-1">Natural language control for your bot fleet</p>
      </div>

      {/* Input area */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-4 space-y-3">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tell your bots what to do..."
          rows={2}
          className="w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 resize-none focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-600">
              Press <kbd className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 font-mono text-[10px]">Ctrl+Enter</kbd> to parse
            </span>
            {input.trim() && (
              <button
                onClick={() => saveDraftToApi(input)}
                className="text-[11px] text-cyan-500 hover:text-cyan-400 transition-colors"
              >
                Save draft
              </button>
            )}
          </div>
          <button
            onClick={handleParse}
            disabled={!input.trim() || parsing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {parsing ? 'Parsing...' : 'Parse'}
          </button>
        </div>

        {/* Suggested commands when input is empty */}
        {!input.trim() && !plan && (
          <div>
            <p className="text-[11px] text-zinc-600 mb-2">Suggested commands:</p>
            <div className="flex flex-wrap gap-2">
              {suggestedCommands.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleExampleClick(prompt)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/40 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3">
          <span className="text-sm text-red-300">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-red-400 hover:text-red-300 text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Plan preview with clarification support */}
      {plan && (
        <CommanderPanel
          plan={plan}
          onExecute={handleExecute}
          onCancel={handleCancel}
          onClarify={handleClarify}
          executing={executing}
          clarifying={clarifying}
        />
      )}

      {/* Execution result */}
      {result && !plan && (
        <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 space-y-3">
          <h3 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Execution Results</h3>
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
                  <span className="font-mono">{cr.command.type}</span>
                  <span className="text-zinc-500">{cr.command.targets.join(', ')}</span>
                  {cr.error && <span className="ml-auto text-red-400">{cr.error}</span>}
                </div>
              ))}
            </div>
          )}
          {result.missionsCreated.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-zinc-400">Missions created: {result.missionsCreated.length}</p>
              {result.missionsCreated.map((m, i) => (
                <div key={i} className="text-xs text-violet-300 px-3 py-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
                  {m.title} - {m.assigneeIds.join(', ')}
                </div>
              ))}
            </div>
          )}
          <button onClick={() => setResult(null)} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            Dismiss
          </button>
        </div>
      )}

      {/* Saved drafts */}
      {drafts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Saved Drafts</h2>
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div
                key={draft.id}
                className="flex items-center gap-3 bg-zinc-900/60 border border-zinc-800/60 rounded-lg px-4 py-3"
              >
                <span className="text-sm text-zinc-300 truncate flex-1">
                  {draft.input.length > 80 ? draft.input.slice(0, 80) + '...' : draft.input}
                </span>
                <span className="text-[10px] text-zinc-600 font-mono shrink-0">
                  {new Date(draft.updatedAt).toLocaleTimeString()}
                </span>
                <button
                  onClick={() => restoreDraft(draft)}
                  className="text-[11px] text-cyan-400 hover:text-cyan-300 transition-colors shrink-0"
                >
                  Restore
                </button>
                <button
                  onClick={() => deleteDraft(draft.id)}
                  className="text-[11px] text-red-400 hover:text-red-300 transition-colors shrink-0"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution history */}
      {history.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">Execution History</h2>
          <div className="space-y-2">
            {history.map((entry, i) => {
              const expanded = expandedHistory === i;
              const succeeded = entry.result?.commandResults.filter((c) => c.success).length ?? 0;
              const failed = entry.result?.commandResults.filter((c) => !c.success).length ?? 0;
              const missions = entry.result?.missionsCreated.length ?? 0;

              return (
                <div
                  key={`${entry.timestamp}-${i}`}
                  className="bg-zinc-900/60 border border-zinc-800/60 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedHistory(expanded ? null : i)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/30 transition-colors"
                  >
                    <span className={`text-zinc-500 transition-transform ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
                    <span className="text-sm text-zinc-300 truncate flex-1">
                      {entry.input.length > 80 ? entry.input.slice(0, 80) + '...' : entry.input}
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

                  {expanded && (
                    <div className="border-t border-zinc-800/50 px-4 py-3 space-y-3">
                      <div>
                        <p className="text-[10px] text-zinc-600 mb-1">Intent</p>
                        <p className="text-xs text-zinc-400">{entry.plan.parsedIntent ?? entry.plan.intent}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-zinc-600 mb-1">Confidence</p>
                        <p className="text-xs text-zinc-400">{Math.round(entry.plan.confidence * 100)}%</p>
                      </div>
                      <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/50">
                        <button
                          onClick={() => handleExampleClick(entry.input)}
                          className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          Reuse input
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
