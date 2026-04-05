'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { api, type Routine, type RoutineStep } from '@/lib/api';
import { useBotStore } from '@/lib/store';
import { useRoutineStore } from '@/lib/store';
import { PageHeader } from '@/components/PageHeader';

// ── Step type labels ───────────────────────────────────────────────

const STEP_TYPE_COLORS: Record<string, string> = {
  command: '#3B82F6',
  mission: '#F59E0B',
};

function StepBadge({ type }: { type: string }) {
  const color = STEP_TYPE_COLORS[type] ?? '#6B7280';
  return (
    <span
      className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded"
      style={{ color, backgroundColor: `${color}15` }}
    >
      {type}
    </span>
  );
}

// ── Step editor row ────────────────────────────────────────────────

function StepRow({
  step,
  index,
  onUpdate,
  onRemove,
}: {
  step: RoutineStep;
  index: number;
  onUpdate: (index: number, step: RoutineStep) => void;
  onRemove: (index: number) => void;
}) {
  const summary =
    step.type === 'command'
      ? `${step.data.command ?? 'unknown'}${step.data.args ? ` (${JSON.stringify(step.data.args)})` : ''}`
      : step.data.description ?? 'No description';

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/20 transition-colors group">
      <span className="text-[11px] text-zinc-600 font-mono w-6 text-right shrink-0">
        {index + 1}
      </span>
      <StepBadge type={step.type} />
      <span className="text-xs text-zinc-300 flex-1 truncate">{summary}</span>
      <button
        onClick={() => onRemove(index)}
        className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ── Add step form ──────────────────────────────────────────────────

function AddStepForm({ onAdd }: { onAdd: (step: RoutineStep) => void }) {
  const [type, setType] = useState<'command' | 'mission'>('mission');
  const [description, setDescription] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');

  const handleAdd = () => {
    if (type === 'mission') {
      if (!description.trim()) return;
      onAdd({ type: 'mission', data: { description: description.trim() } });
      setDescription('');
    } else {
      if (!command.trim()) return;
      let parsedArgs = {};
      if (args.trim()) {
        try {
          parsedArgs = JSON.parse(args.trim());
        } catch {
          return; // invalid JSON
        }
      }
      onAdd({ type: 'command', data: { command: command.trim(), args: parsedArgs } });
      setCommand('');
      setArgs('');
    }
  };

  return (
    <div className="px-4 py-3 border-t border-zinc-800/40 space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'command' | 'mission')}
          className="bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white"
        >
          <option value="mission">Mission (Task)</option>
          <option value="command">Command</option>
        </select>
        {type === 'mission' ? (
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Task description..."
            className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
          />
        ) : (
          <>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="Command name..."
              className="w-40 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
            />
            <input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              placeholder='Args JSON (optional)...'
              className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
            />
          </>
        )}
        <button
          onClick={handleAdd}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors shrink-0"
        >
          Add Step
        </button>
      </div>
    </div>
  );
}

// ── Execute modal ──────────────────────────────────────────────────

function ExecuteModal({
  routine,
  onClose,
  onExecute,
}: {
  routine: Routine;
  onClose: () => void;
  onExecute: (botNames: string[]) => void;
}) {
  const bots = useBotStore((s) => s.botList);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(bots.map((b) => b.name)));
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-zinc-900 border border-zinc-700/60 rounded-xl p-5 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-white mb-1">Execute Routine</h3>
        <p className="text-xs text-zinc-500 mb-4">
          Run &quot;{routine.name}&quot; ({routine.steps.length} step{routine.steps.length !== 1 ? 's' : ''}) on selected bots.
        </p>

        {bots.length === 0 ? (
          <p className="text-xs text-zinc-500 py-4 text-center">No bots available</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-zinc-400">Select target bots:</span>
              <button onClick={selectAll} className="text-[11px] text-emerald-400 hover:text-emerald-300 transition-colors">
                Select all
              </button>
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto mb-4">
              {bots.map((bot) => (
                <label
                  key={bot.name}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                    selected.has(bot.name) ? 'bg-emerald-500/10 border border-emerald-500/30' : 'border border-zinc-800/40 hover:bg-zinc-800/30'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(bot.name)}
                    onChange={() => toggle(bot.name)}
                    className="accent-emerald-500"
                  />
                  <span className="text-xs text-white font-medium">{bot.name}</span>
                  <span className="text-[10px] text-zinc-500 capitalize">{bot.personality}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onExecute(Array.from(selected))}
            disabled={selected.size === 0}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
          >
            Execute
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────

export default function RoutinesPage() {
  const { routines, setRoutines, addRoutine, updateRoutine, removeRoutine, recording, draft, setRecording } =
    useRoutineStore();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [executeRoutine, setExecuteRoutine] = useState<Routine | null>(null);
  const [executing, setExecuting] = useState(false);
  const [recordName, setRecordName] = useState('');
  const [loading, setLoading] = useState(true);

  // Load routines on mount (in parallel)
  useEffect(() => {
    Promise.all([
      api.getRoutines().then((data) => setRoutines(data.routines)).catch(() => {}),
      api.getRecordingStatus().then((data) => setRecording(data.recording, data.draft)).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [setRoutines, setRecording]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      const { routine } = await api.createRoutine({ name: newName.trim() });
      addRoutine(routine);
      setNewName('');
      setEditingId(routine.id);
      setSuccess(`Routine "${routine.name}" created`);
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this routine? This cannot be undone.')) return;
    setError(null);
    try {
      await api.deleteRoutine(id);
      removeRoutine(id);
      if (editingId === id) setEditingId(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleUpdateSteps = async (id: string, steps: RoutineStep[]) => {
    try {
      const { routine } = await api.updateRoutine(id, { steps });
      updateRoutine(routine);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleAddStep = (id: string, step: RoutineStep) => {
    const routine = routines.find((r) => r.id === id);
    if (!routine) return;
    handleUpdateSteps(id, [...routine.steps, step]);
  };

  const handleRemoveStep = (id: string, index: number) => {
    const routine = routines.find((r) => r.id === id);
    if (!routine) return;
    handleUpdateSteps(id, routine.steps.filter((_, i) => i !== index));
  };

  const handleExecute = async (botNames: string[]) => {
    if (!executeRoutine) return;
    setExecuting(true);
    setError(null);
    try {
      const { execution } = await api.executeRoutine(executeRoutine.id, botNames);
      setExecuteRoutine(null);
      if (execution.status === 'completed') {
        setSuccess(`Routine "${execution.routineName}" completed (${execution.stepsCompleted} steps)`);
      } else {
        setError(`Routine failed: ${execution.error ?? 'unknown error'}`);
      }
      setTimeout(() => setSuccess(null), 4000);
    } catch (e: any) {
      setError(e.message);
    }
    setExecuting(false);
  };

  const handleStartRecording = async () => {
    if (!recordName.trim()) return;
    setError(null);
    try {
      const { draft } = await api.startRecording(recordName.trim());
      setRecording(true, draft);
      setRecordName('');
      setSuccess('Recording started -- actions will be captured');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleStopRecording = async (save: boolean) => {
    setError(null);
    try {
      const { routine } = await api.stopRecording(save);
      setRecording(false, null);
      if (routine && save) {
        addRoutine(routine);
        setSuccess(`Recording saved as "${routine.name}" (${routine.steps.length} steps)`);
        setTimeout(() => setSuccess(null), 3000);
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-5xl">
      <PageHeader title="Routines" subtitle={`${routines.length} macro${routines.length !== 1 ? 's' : ''} saved`} />

      {/* Messages */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 px-4 py-2.5 rounded-lg flex items-center justify-between"
        >
          {error}
          <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400 ml-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </motion.div>
      )}
      {success && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 px-4 py-2.5 rounded-lg"
        >
          {success}
        </motion.div>
      )}

      {/* Recording banner */}
      {recording && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-3">
            <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
            <div>
              <p className="text-sm font-semibold text-red-400">Recording: {draft?.name ?? 'Untitled'}</p>
              <p className="text-xs text-zinc-500 mt-0.5">
                {draft?.steps.length ?? 0} step{(draft?.steps.length ?? 0) !== 1 ? 's' : ''} captured.
                Issue commands from the dashboard and they will be recorded.
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => handleStopRecording(false)}
              className="text-xs text-zinc-400 hover:text-zinc-200 px-3 py-1.5 rounded-lg border border-zinc-700 hover:bg-zinc-800 transition-colors"
            >
              Discard
            </button>
            <button
              onClick={() => handleStopRecording(true)}
              className="text-xs text-white bg-red-600 hover:bg-red-500 px-3 py-1.5 rounded-lg font-medium transition-colors"
            >
              Stop &amp; Save
            </button>
          </div>
        </motion.div>
      )}

      {/* Create / Record */}
      <div className="flex gap-3">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex-1 bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
        >
          <h2 className="text-sm font-semibold text-white mb-3">Create Routine</h2>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Routine name..."
              className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600"
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              Create
            </button>
          </div>
        </motion.div>

        {!recording && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="flex-1 bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
          >
            <h2 className="text-sm font-semibold text-white mb-3">Record Macro</h2>
            <div className="flex gap-2">
              <input
                value={recordName}
                onChange={(e) => setRecordName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleStartRecording()}
                placeholder="Recording name..."
                className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600"
              />
              <button
                onClick={handleStartRecording}
                disabled={!recordName.trim()}
                className="bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                <span className="w-2 h-2 rounded-full bg-white" />
                Record
              </button>
            </div>
          </motion.div>
        )}
      </div>

      {/* Routine list */}
      {loading ? (
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 py-16 text-center">
          <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-zinc-500">Loading routines...</p>
        </div>
      ) : routines.length === 0 ? (
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 py-16 text-center">
          <p className="text-sm text-zinc-500">No routines yet</p>
          <p className="text-xs text-zinc-600 mt-1">Create a routine above or record one from your actions</p>
        </div>
      ) : (
        <div className="space-y-3">
          {routines.map((routine, i) => {
            const isEditing = editingId === routine.id;
            return (
              <motion.div
                key={routine.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
              >
                {/* Header */}
                <div className="flex items-center gap-4 px-5 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white truncate">{routine.name}</h3>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {routine.steps.length} step{routine.steps.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {routine.description && (
                      <p className="text-xs text-zinc-500 mt-0.5 truncate">{routine.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setExecuteRoutine(routine)}
                      disabled={routine.steps.length === 0}
                      className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 disabled:text-zinc-600 px-2.5 py-1.5 rounded-lg border border-emerald-500/30 hover:bg-emerald-500/10 disabled:border-zinc-800 disabled:hover:bg-transparent transition-colors"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                      Execute
                    </button>
                    <button
                      onClick={() => setEditingId(isEditing ? null : routine.id)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                        isEditing
                          ? 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10'
                          : 'text-zinc-400 border-zinc-700 hover:text-zinc-200 hover:bg-zinc-800'
                      }`}
                    >
                      {isEditing ? 'Close' : 'Edit'}
                    </button>
                    <button
                      onClick={() => handleDelete(routine.id)}
                      className="text-zinc-600 hover:text-red-400 px-2 py-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Steps (expanded when editing) */}
                {isEditing && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    className="border-t border-zinc-800/40"
                  >
                    {routine.steps.length === 0 ? (
                      <div className="px-4 py-6 text-center">
                        <p className="text-xs text-zinc-500">No steps yet. Add one below.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-zinc-800/30">
                        {routine.steps.map((step, si) => (
                          <StepRow
                            key={si}
                            step={step}
                            index={si}
                            onUpdate={() => {}}
                            onRemove={(idx) => handleRemoveStep(routine.id, idx)}
                          />
                        ))}
                      </div>
                    )}
                    <AddStepForm onAdd={(step) => handleAddStep(routine.id, step)} />
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Execute modal */}
      {executeRoutine && (
        <ExecuteModal
          routine={executeRoutine}
          onClose={() => setExecuteRoutine(null)}
          onExecute={handleExecute}
        />
      )}
    </div>
  );
}
