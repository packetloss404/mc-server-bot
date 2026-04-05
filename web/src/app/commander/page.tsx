'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBotStore } from '@/lib/store';
import {
  api,
  type CommandTemplate,
  type ContextSuggestion,
  type SavedRoutine,
  type RoutineStep,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

const CATEGORIES = [
  { key: 'all', label: 'All', icon: '~' },
  { key: 'fleet', label: 'Fleet', icon: '>' },
  { key: 'combat', label: 'Combat', icon: '!' },
  { key: 'gathering', label: 'Gathering', icon: '+' },
  { key: 'building', label: 'Building', icon: '#' },
  { key: 'exploration', label: 'Explore', icon: '?' },
  { key: 'utility', label: 'Utility', icon: '*' },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  fleet: '#60A5FA',
  combat: '#EF4444',
  gathering: '#10B981',
  building: '#F59E0B',
  exploration: '#A78BFA',
  utility: '#6B7280',
};

// ---------------------------------------------------------------------------
// Helper: fill template text locally (for preview)
// ---------------------------------------------------------------------------

function fillTemplateLocal(
  template: string,
  placeholders: CommandTemplate['placeholders'],
  values: Record<string, string>,
): string {
  let text = template;
  for (const ph of placeholders) {
    const val = values[ph.key] || '';
    text = text.replace(`{${ph.key}}`, val || `{${ph.key}}`);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CommanderPage() {
  const bots = useBotStore((s) => s.botList);

  // Data
  const [templates, setTemplates] = useState<CommandTemplate[]>([]);
  const [suggestions, setSuggestions] = useState<ContextSuggestion[]>([]);
  const [routines, setRoutines] = useState<SavedRoutine[]>([]);

  // UI state
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<CommandTemplate | null>(null);
  const [placeholderValues, setPlaceholderValues] = useState<Record<string, string>>({});
  const [commandInput, setCommandInput] = useState('');
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showRoutineBuilder, setShowRoutineBuilder] = useState(false);
  const [routineName, setRoutineName] = useState('');
  const [routineDesc, setRoutineDesc] = useState('');
  const [routineSteps, setRoutineSteps] = useState<{ templateId: string; values: Record<string, string> }[]>([]);

  // Fetch data
  const fetchData = useCallback(async () => {
    try {
      const [tmplData, sugData, routData] = await Promise.all([
        api.getCommanderTemplates(),
        api.getCommanderSuggestions(),
        api.getRoutines(),
      ]);
      setTemplates(tmplData.templates);
      setSuggestions(sugData.suggestions);
      setRoutines(routData.routines);
    } catch {
      // API might not be available yet
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Re-fetch suggestions when bots change
  useEffect(() => {
    api.getCommanderSuggestions().then((d) => setSuggestions(d.suggestions)).catch(() => {});
  }, [bots]);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    let list = templates;
    if (selectedCategory !== 'all') {
      list = list.filter((t) => t.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.includes(q)),
      );
    }
    return list;
  }, [templates, selectedCategory, searchQuery]);

  // Select a template
  const handleSelectTemplate = (tmpl: CommandTemplate) => {
    setSelectedTemplate(tmpl);
    // Initialize placeholder values with defaults
    const defaults: Record<string, string> = {};
    for (const ph of tmpl.placeholders) {
      if (ph.type === 'bot' && bots.length > 0) {
        defaults[ph.key] = bots[0].name;
      } else {
        defaults[ph.key] = ph.default || '';
      }
    }
    setPlaceholderValues(defaults);
    // Fill input
    setCommandInput(fillTemplateLocal(tmpl.template, tmpl.placeholders, defaults));
    setExecutionResult(null);
  };

  // Update a placeholder value
  const handlePlaceholderChange = (key: string, value: string) => {
    const updated = { ...placeholderValues, [key]: value };
    setPlaceholderValues(updated);
    if (selectedTemplate) {
      setCommandInput(fillTemplateLocal(selectedTemplate.template, selectedTemplate.placeholders, updated));
    }
  };

  // Execute command (dispatch as swarm directive or task)
  const handleExecute = async () => {
    if (!commandInput.trim()) return;
    setExecuting(true);
    setExecutionResult(null);
    try {
      // If it targets a specific bot, queue it as a task; otherwise use swarm directive
      const singleBotMatch = commandInput.match(/^(?:Have|Move|Send)\s+(\w+)\s/i);
      const targetBot = singleBotMatch
        ? bots.find((b) => b.name.toLowerCase() === singleBotMatch[1].toLowerCase())
        : null;

      if (targetBot) {
        await api.queueTask(targetBot.name, commandInput);
        setExecutionResult({ success: true, message: `Task queued for ${targetBot.name}` });
      } else {
        // Use the swarm endpoint for fleet-wide commands
        await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/swarm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: commandInput, requestedBy: 'commander' }),
        });
        setExecutionResult({ success: true, message: 'Command dispatched to fleet' });
      }
    } catch (e: any) {
      setExecutionResult({ success: false, message: e.message || 'Execution failed' });
    }
    setExecuting(false);
  };

  // Add current template as a routine step
  const handleAddRoutineStep = () => {
    if (!selectedTemplate) return;
    setRoutineSteps([...routineSteps, { templateId: selectedTemplate.id, values: { ...placeholderValues } }]);
  };

  // Save routine
  const handleSaveRoutine = async () => {
    if (!routineName.trim() || routineSteps.length === 0) return;
    try {
      await api.createRoutine(routineName.trim(), routineDesc.trim(), routineSteps);
      setRoutineName('');
      setRoutineDesc('');
      setRoutineSteps([]);
      setShowRoutineBuilder(false);
      fetchData();
    } catch { /* ignore */ }
  };

  // Execute a saved routine
  const handleExecuteRoutine = async (routine: SavedRoutine) => {
    setExecuting(true);
    setExecutionResult(null);
    try {
      const { commands } = await api.expandRoutine(routine.id);
      for (const cmd of commands) {
        const singleBotMatch = cmd.match(/^(?:Have|Move|Send)\s+(\w+)\s/i);
        const targetBot = singleBotMatch
          ? bots.find((b) => b.name.toLowerCase() === singleBotMatch[1].toLowerCase())
          : null;
        if (targetBot) {
          await api.queueTask(targetBot.name, cmd);
        } else {
          await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/swarm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: cmd, requestedBy: 'commander' }),
          });
        }
      }
      setExecutionResult({ success: true, message: `Routine "${routine.name}" executed (${commands.length} commands)` });
    } catch (e: any) {
      setExecutionResult({ success: false, message: e.message || 'Routine execution failed' });
    }
    setExecuting(false);
  };

  // Delete a routine
  const handleDeleteRoutine = async (id: string) => {
    try {
      await api.deleteRoutine(id);
      fetchData();
    } catch { /* ignore */ }
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1400px]">
      <PageHeader
        title="Commander"
        subtitle="Command templates, context-aware suggestions, and saved routines"
      />

      <div className="mt-6 flex gap-6">
        {/* ── Left: Template Sidebar ───────────────────────── */}
        <div className="w-[340px] shrink-0 space-y-4">
          {/* Search */}
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              className="w-full bg-zinc-900/80 border border-zinc-800/60 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            />
          </div>

          {/* Category tabs */}
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setSelectedCategory(cat.key)}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                  selectedCategory === cat.key
                    ? 'bg-zinc-700/80 text-white'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/60'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Template list */}
          <div className="space-y-1 max-h-[60vh] overflow-y-auto pr-1">
            {filteredTemplates.map((tmpl) => {
              const isActive = selectedTemplate?.id === tmpl.id;
              const catColor = CATEGORY_COLORS[tmpl.category] || '#6B7280';
              return (
                <motion.button
                  key={tmpl.id}
                  onClick={() => handleSelectTemplate(tmpl)}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${
                    isActive
                      ? 'bg-zinc-800/80 border-zinc-600/60'
                      : 'bg-zinc-900/50 border-zinc-800/40 hover:bg-zinc-800/40 hover:border-zinc-700/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm shrink-0">{tmpl.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-white truncate">{tmpl.name}</p>
                      <p className="text-[10px] text-zinc-500 truncate mt-0.5">{tmpl.description}</p>
                    </div>
                    <span
                      className="text-[9px] font-medium uppercase px-1.5 py-0.5 rounded shrink-0"
                      style={{ color: catColor, backgroundColor: `${catColor}15` }}
                    >
                      {tmpl.category}
                    </span>
                  </div>
                </motion.button>
              );
            })}
            {filteredTemplates.length === 0 && (
              <p className="text-xs text-zinc-600 text-center py-8">No templates match your search</p>
            )}
          </div>
        </div>

        {/* ── Right: Main content ──────────────────────────── */}
        <div className="flex-1 space-y-5 min-w-0">
          {/* Context-aware suggestions */}
          {suggestions.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                Suggested Commands
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {suggestions.map((sug) => {
                  const catColor = CATEGORY_COLORS[sug.template.category] || '#6B7280';
                  return (
                    <motion.button
                      key={sug.template.id}
                      onClick={() => handleSelectTemplate(sug.template)}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={{ scale: 1.01 }}
                      className="text-left bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-3 hover:border-zinc-600/60 transition-all group"
                    >
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm">{sug.template.icon}</span>
                        <span className="text-xs font-medium text-white group-hover:text-emerald-300 transition-colors">
                          {sug.template.name}
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-500 leading-relaxed">{sug.reason}</p>
                      <div className="mt-2 flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: catColor }}
                        />
                        <span className="text-[9px] text-zinc-600 uppercase">{sug.template.category}</span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Command Input Area */}
          <section className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              Command Input
            </h2>

            {/* Placeholder editors */}
            {selectedTemplate && selectedTemplate.placeholders.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                {selectedTemplate.placeholders.map((ph) => (
                  <div key={ph.key}>
                    <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wide block mb-1">
                      {ph.label}
                    </label>
                    {ph.type === 'bot' ? (
                      <select
                        value={placeholderValues[ph.key] || ''}
                        onChange={(e) => handlePlaceholderChange(ph.key, e.target.value)}
                        className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-500"
                      >
                        <option value="">Select bot...</option>
                        {bots.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name} ({b.personality})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={placeholderValues[ph.key] || ''}
                        onChange={(e) => handlePlaceholderChange(ph.key, e.target.value)}
                        placeholder={ph.default || ph.label}
                        className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Main input */}
            <div className="flex gap-2">
              <input
                value={commandInput}
                onChange={(e) => {
                  setCommandInput(e.target.value);
                  if (selectedTemplate) setSelectedTemplate(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleExecute()}
                placeholder="Type a command or select a template..."
                className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-600/50"
              />
              <button
                onClick={handleExecute}
                disabled={executing || !commandInput.trim()}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors shrink-0"
              >
                {executing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Running
                  </span>
                ) : (
                  'Execute'
                )}
              </button>
            </div>

            {/* Template preview line */}
            {selectedTemplate && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[10px] text-zinc-600">Template:</span>
                <span className="text-[10px] text-zinc-400 font-mono">
                  {selectedTemplate.template}
                </span>
                {showRoutineBuilder && (
                  <button
                    onClick={handleAddRoutineStep}
                    className="ml-auto text-[10px] text-emerald-500 hover:text-emerald-400 transition-colors"
                  >
                    + Add to routine
                  </button>
                )}
              </div>
            )}

            {/* Execution result */}
            <AnimatePresence>
              {executionResult && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`mt-3 text-xs px-3 py-2 rounded-lg border ${
                    executionResult.success
                      ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20'
                      : 'text-red-400 bg-red-400/10 border-red-400/20'
                  }`}
                >
                  {executionResult.message}
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          {/* Saved Routines */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                Saved Routines
              </h2>
              <button
                onClick={() => setShowRoutineBuilder(!showRoutineBuilder)}
                className="text-[11px] text-emerald-500 hover:text-emerald-400 transition-colors font-medium"
              >
                {showRoutineBuilder ? 'Cancel' : '+ New Routine'}
              </button>
            </div>

            {/* Routine builder */}
            <AnimatePresence>
              {showRoutineBuilder && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 mb-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wide block mb-1">
                          Name
                        </label>
                        <input
                          value={routineName}
                          onChange={(e) => setRoutineName(e.target.value)}
                          placeholder="e.g. Morning Setup"
                          className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-500 font-medium uppercase tracking-wide block mb-1">
                          Description
                        </label>
                        <input
                          value={routineDesc}
                          onChange={(e) => setRoutineDesc(e.target.value)}
                          placeholder="Optional description"
                          className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                        />
                      </div>
                    </div>

                    {/* Steps list */}
                    {routineSteps.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-zinc-500 font-medium uppercase">Steps ({routineSteps.length})</p>
                        {routineSteps.map((step, i) => {
                          const tmpl = templates.find((t) => t.id === step.templateId);
                          return (
                            <div
                              key={i}
                              className="flex items-center gap-2 bg-zinc-800/50 rounded-lg px-3 py-1.5"
                            >
                              <span className="text-[10px] text-zinc-600 font-mono w-4">{i + 1}.</span>
                              <span className="text-xs text-zinc-300 flex-1 truncate">
                                {tmpl ? fillTemplateLocal(tmpl.template, tmpl.placeholders, step.values) : step.templateId}
                              </span>
                              <button
                                onClick={() => setRoutineSteps(routineSteps.filter((_, j) => j !== i))}
                                className="text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <p className="text-[10px] text-zinc-600">
                      Select a template from the sidebar, fill placeholders, then click "Add to routine" to add steps.
                    </p>

                    <button
                      onClick={handleSaveRoutine}
                      disabled={!routineName.trim() || routineSteps.length === 0}
                      className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
                    >
                      Save Routine
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Routine cards */}
            {routines.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {routines.map((routine) => (
                  <motion.div
                    key={routine.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-zinc-900/50 border border-zinc-800/40 rounded-xl p-4 hover:border-zinc-700/50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="text-xs font-medium text-white">{routine.name}</p>
                        {routine.description && (
                          <p className="text-[10px] text-zinc-500 mt-0.5">{routine.description}</p>
                        )}
                      </div>
                      <span className="text-[10px] text-zinc-600 shrink-0">
                        {routine.steps.length} step{routine.steps.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => handleExecuteRoutine(routine)}
                        disabled={executing}
                        className="text-[11px] text-emerald-500 hover:text-emerald-400 font-medium transition-colors"
                      >
                        Run
                      </button>
                      <span className="text-zinc-800">|</span>
                      <button
                        onClick={() => handleDeleteRoutine(routine.id)}
                        className="text-[11px] text-zinc-600 hover:text-red-400 font-medium transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              !showRoutineBuilder && (
                <div className="text-center py-8 bg-zinc-900/30 rounded-xl border border-zinc-800/30">
                  <p className="text-xs text-zinc-600">No saved routines yet</p>
                  <p className="text-[10px] text-zinc-700 mt-1">Create one to save multi-step command sequences</p>
                </div>
              )
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
