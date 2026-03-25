'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, SupplyChain, ChainTemplate, ChainStage, MissionRecord } from '@/lib/api';
import { useBotStore } from '@/lib/store';
import { PageHeader } from '@/components/PageHeader';

const STAGE_STATUS_COLORS: Record<string, string> = {
  pending: '#6B7280',
  queued: '#F59E0B',
  running: '#10B981',
  completed: '#3B82F6',
  failed: '#EF4444',
};

const CHAIN_STATUS_COLORS: Record<string, string> = {
  idle: '#6B7280',
  running: '#10B981',
  paused: '#F59E0B',
  completed: '#3B82F6',
  failed: '#EF4444',
};

const MISSION_STATUS_COLORS: Record<string, string> = {
  draft: '#6B7280',
  queued: '#F59E0B',
  running: '#1ABC9C',
  paused: '#F59E0B',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#6B7280',
};

function StatusBadge({ status, colors }: { status: string; colors: Record<string, string> }) {
  const color = colors[status] ?? '#6B7280';
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {status}
    </span>
  );
}

interface StageFormData {
  botName: string;
  task: string;
  inputChest: { x: string; y: string; z: string; label: string };
  outputChest: { x: string; y: string; z: string; label: string };
  inputItems: { item: string; count: string }[];
  outputItems: { item: string; count: string }[];
}

function emptyStage(): StageFormData {
  return {
    botName: '',
    task: '',
    inputChest: { x: '', y: '', z: '', label: '' },
    outputChest: { x: '', y: '', z: '', label: '' },
    inputItems: [],
    outputItems: [],
  };
}

function ChainCard({
  chain,
  mission,
  onSelect,
  onStart,
  onPause,
  onCancel,
  onDelete,
}: {
  chain: SupplyChain;
  mission?: MissionRecord | null;
  onSelect: () => void;
  onStart: () => void;
  onPause: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 cursor-pointer hover:border-amber-500/30 transition-colors"
      onClick={onSelect}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{chain.name}</h3>
          {chain.description && (
            <p className="text-xs text-zinc-400 mt-1 line-clamp-2">{chain.description}</p>
          )}
        </div>
        <StatusBadge status={chain.status} colors={CHAIN_STATUS_COLORS} />
      </div>

      <div className="flex items-center gap-3 text-xs text-zinc-500 mb-4">
        <span>{chain.stages.length} stage{chain.stages.length !== 1 ? 's' : ''}</span>
        <span className="text-zinc-700">|</span>
        <span>Stage {chain.currentStageIndex + 1} of {chain.stages.length}</span>
        {chain.loop && (
          <>
            <span className="text-zinc-700">|</span>
            <span className="text-amber-500">Loop</span>
          </>
        )}
      </div>

      {/* Mission link */}
      {mission && (
        <div className="flex items-center gap-2 mb-3 bg-zinc-800/40 rounded-lg px-2.5 py-1.5">
          <span className="text-[9px] text-zinc-500 uppercase font-bold tracking-wider">Mission</span>
          <StatusBadge status={mission.status} colors={MISSION_STATUS_COLORS} />
        </div>
      )}

      {/* Mini stage indicators */}
      <div className="flex items-center gap-1 mb-4">
        {chain.stages.map((stage, i) => {
          const color = STAGE_STATUS_COLORS[stage.status] ?? '#6B7280';
          return (
            <div
              key={stage.id}
              className="flex-1 h-1.5 rounded-full transition-colors"
              style={{ backgroundColor: i === chain.currentStageIndex && chain.status === 'running' ? color : `${color}40` }}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {(chain.status === 'idle' || chain.status === 'paused') && (
          <button
            onClick={onStart}
            className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
          >
            Start
          </button>
        )}
        {chain.status === 'running' && (
          <button
            onClick={onPause}
            className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-zinc-700/50 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Pause
          </button>
        )}
        {(chain.status === 'running' || chain.status === 'paused') && (
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Cancel
          </button>
        )}
        {(chain.status === 'idle' || chain.status === 'completed' || chain.status === 'failed') && (
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </motion.div>
  );
}

function StageCard({ stage, index, isActive }: { stage: ChainStage; index: number; isActive: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`relative shrink-0 w-64 bg-zinc-900/80 border rounded-xl p-4 transition-colors ${
        isActive ? 'border-amber-500/60 shadow-[0_0_16px_rgba(245,158,11,0.15)]' : 'border-zinc-800/60'
      }`}
    >
      {isActive && stage.status === 'running' && (
        <motion.div
          className="absolute inset-0 rounded-xl border-2 border-amber-500/40"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Stage {index + 1}</span>
        <StatusBadge status={stage.status} colors={STAGE_STATUS_COLORS} />
      </div>
      <p className="text-xs font-medium text-white mb-1">{stage.botName}</p>
      <p className="text-[11px] text-zinc-400 mb-3 line-clamp-2">{stage.task}</p>

      {stage.inputChest && (
        <div className="text-[10px] text-zinc-500 mb-1">
          Input: {stage.inputChest.label || `${stage.inputChest.x}, ${stage.inputChest.y}, ${stage.inputChest.z}`}
        </div>
      )}
      {stage.outputChest && (
        <div className="text-[10px] text-zinc-500 mb-1">
          Output: {stage.outputChest.label || `${stage.outputChest.x}, ${stage.outputChest.y}, ${stage.outputChest.z}`}
        </div>
      )}

      {stage.inputItems && stage.inputItems.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {stage.inputItems.map((item, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-zinc-800 text-zinc-400">
              {item.count}x {item.item}
            </span>
          ))}
        </div>
      )}
      {stage.outputItems && stage.outputItems.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {stage.outputItems.map((item, i) => (
            <span key={i} className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/10 text-amber-400">
              {item.count}x {item.item}
            </span>
          ))}
        </div>
      )}

      {stage.error && (
        <p className="text-[10px] text-red-400 mt-2 truncate">{stage.error}</p>
      )}
    </motion.div>
  );
}

function StageArrow() {
  return (
    <div className="shrink-0 flex items-center">
      <div className="w-8 h-0.5 bg-zinc-700" />
      <div className="w-0 h-0 border-t-[5px] border-t-transparent border-b-[5px] border-b-transparent border-l-[8px] border-l-zinc-700" />
    </div>
  );
}

function CreateChainForm({
  templates,
  botNames,
  onCreated,
  onCancel,
}: {
  templates: ChainTemplate[];
  botNames: string[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState<'template' | 'custom'>('template');
  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [stages, setStages] = useState<StageFormData[]>([emptyStage()]);
  const [loop, setLoop] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplate(templateId);
    const tmpl = templates.find((t) => t.id === templateId);
    if (tmpl) {
      setStages(
        tmpl.stages.map((s) => ({
          botName: '',
          task: s.task,
          inputChest: { x: '', y: '', z: '', label: '' },
          outputChest: { x: '', y: '', z: '', label: '' },
          inputItems: s.inputItems?.map((i) => ({ item: i.item, count: String(i.count) })) ?? [],
          outputItems: s.outputItems?.map((i) => ({ item: i.item, count: String(i.count) })) ?? [],
        })),
      );
    }
  };

  const updateStage = (index: number, patch: Partial<StageFormData>) => {
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const addStage = () => setStages((prev) => [...prev, emptyStage()]);
  const removeStage = (index: number) => setStages((prev) => prev.filter((_, i) => i !== index));

  const addInputItem = (stageIdx: number) => {
    setStages((prev) =>
      prev.map((s, i) =>
        i === stageIdx ? { ...s, inputItems: [...s.inputItems, { item: '', count: '1' }] } : s,
      ),
    );
  };

  const addOutputItem = (stageIdx: number) => {
    setStages((prev) =>
      prev.map((s, i) =>
        i === stageIdx ? { ...s, outputItems: [...s.outputItems, { item: '', count: '1' }] } : s,
      ),
    );
  };

  const updateInputItem = (stageIdx: number, itemIdx: number, patch: Partial<{ item: string; count: string }>) => {
    setStages((prev) =>
      prev.map((s, i) =>
        i === stageIdx
          ? { ...s, inputItems: s.inputItems.map((it, j) => (j === itemIdx ? { ...it, ...patch } : it)) }
          : s,
      ),
    );
  };

  const updateOutputItem = (stageIdx: number, itemIdx: number, patch: Partial<{ item: string; count: string }>) => {
    setStages((prev) =>
      prev.map((s, i) =>
        i === stageIdx
          ? { ...s, outputItems: s.outputItems.map((it, j) => (j === itemIdx ? { ...it, ...patch } : it)) }
          : s,
      ),
    );
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (stages.some((s) => !s.botName || !s.task.trim())) {
      setError('Every stage needs a bot and task');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        loop,
        stages: stages.map((s) => ({
          botName: s.botName,
          task: s.task,
          inputChest: s.inputChest.x ? { x: Number(s.inputChest.x), y: Number(s.inputChest.y), z: Number(s.inputChest.z), label: s.inputChest.label } : undefined,
          outputChest: s.outputChest.x ? { x: Number(s.outputChest.x), y: Number(s.outputChest.y), z: Number(s.outputChest.z), label: s.outputChest.label } : undefined,
          inputItems: s.inputItems.filter((i) => i.item).map((i) => ({ item: i.item, count: Number(i.count) || 1 })),
          outputItems: s.outputItems.filter((i) => i.item).map((i) => ({ item: i.item, count: Number(i.count) || 1 })),
        })),
      };
      await api.createChain(payload);
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create chain');
    } finally {
      setCreating(false);
    }
  };

  const inputClass = 'w-full bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50';
  const smallInputClass = 'bg-zinc-800/60 border border-zinc-700/50 rounded px-2 py-1 text-[11px] text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-6"
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-white">Create Supply Chain</h2>
        <button onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
          Cancel
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">Name</label>
          <input className={inputClass} placeholder="e.g. Iron Pipeline" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">Description (optional)</label>
          <input className={inputClass} placeholder="What does this chain do?" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {/* Mode toggle */}
        <div>
          <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">Build Mode</label>
          <div className="flex gap-2">
            <button
              className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-colors ${
                mode === 'template' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-300'
              }`}
              onClick={() => setMode('template')}
            >
              From Template
            </button>
            <button
              className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-colors ${
                mode === 'custom' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-300'
              }`}
              onClick={() => setMode('custom')}
            >
              Custom
            </button>
          </div>
        </div>

        {/* Template selector */}
        {mode === 'template' && (
          <div>
            <label className="block text-[11px] font-medium text-zinc-400 mb-1.5">Template</label>
            <select
              className={inputClass}
              value={selectedTemplate}
              onChange={(e) => handleTemplateChange(e.target.value)}
            >
              <option value="">Select a template...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name} - {t.description}</option>
              ))}
            </select>
          </div>
        )}

        {/* Stages */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] font-medium text-zinc-400">Stages</label>
            {mode === 'custom' && (
              <button onClick={addStage} className="text-[11px] text-amber-400 hover:text-amber-300 transition-colors">
                + Add Stage
              </button>
            )}
          </div>

          <div className="space-y-3">
            {stages.map((stage, idx) => (
              <div key={idx} className="bg-zinc-800/40 border border-zinc-700/30 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Stage {idx + 1}</span>
                  {stages.length > 1 && (
                    <button onClick={() => removeStage(idx)} className="text-[10px] text-red-400 hover:text-red-300">
                      Remove
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Bot</label>
                    <select
                      className={inputClass}
                      value={stage.botName}
                      onChange={(e) => updateStage(idx, { botName: e.target.value })}
                    >
                      <option value="">Select bot...</option>
                      {botNames.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Task</label>
                    <input
                      className={inputClass}
                      placeholder="e.g. Mine 64 iron ore"
                      value={stage.task}
                      onChange={(e) => updateStage(idx, { task: e.target.value })}
                    />
                  </div>
                </div>

                {/* Chest coords */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Input Chest (optional)</label>
                    <div className="flex gap-1">
                      <input className={smallInputClass + ' w-14'} placeholder="x" value={stage.inputChest.x} onChange={(e) => updateStage(idx, { inputChest: { ...stage.inputChest, x: e.target.value } })} />
                      <input className={smallInputClass + ' w-14'} placeholder="y" value={stage.inputChest.y} onChange={(e) => updateStage(idx, { inputChest: { ...stage.inputChest, y: e.target.value } })} />
                      <input className={smallInputClass + ' w-14'} placeholder="z" value={stage.inputChest.z} onChange={(e) => updateStage(idx, { inputChest: { ...stage.inputChest, z: e.target.value } })} />
                      <input className={smallInputClass + ' flex-1'} placeholder="label" value={stage.inputChest.label} onChange={(e) => updateStage(idx, { inputChest: { ...stage.inputChest, label: e.target.value } })} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] text-zinc-500 mb-1">Output Chest (optional)</label>
                    <div className="flex gap-1">
                      <input className={smallInputClass + ' w-14'} placeholder="x" value={stage.outputChest.x} onChange={(e) => updateStage(idx, { outputChest: { ...stage.outputChest, x: e.target.value } })} />
                      <input className={smallInputClass + ' w-14'} placeholder="y" value={stage.outputChest.y} onChange={(e) => updateStage(idx, { outputChest: { ...stage.outputChest, y: e.target.value } })} />
                      <input className={smallInputClass + ' w-14'} placeholder="z" value={stage.outputChest.z} onChange={(e) => updateStage(idx, { outputChest: { ...stage.outputChest, z: e.target.value } })} />
                      <input className={smallInputClass + ' flex-1'} placeholder="label" value={stage.outputChest.label} onChange={(e) => updateStage(idx, { outputChest: { ...stage.outputChest, label: e.target.value } })} />
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-zinc-500">Input Items</label>
                      <button onClick={() => addInputItem(idx)} className="text-[9px] text-amber-400 hover:text-amber-300">+ Add</button>
                    </div>
                    {stage.inputItems.map((item, ii) => (
                      <div key={ii} className="flex gap-1 mb-1">
                        <input className={smallInputClass + ' flex-1'} placeholder="item" value={item.item} onChange={(e) => updateInputItem(idx, ii, { item: e.target.value })} />
                        <input className={smallInputClass + ' w-12'} placeholder="qty" value={item.count} onChange={(e) => updateInputItem(idx, ii, { count: e.target.value })} />
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-zinc-500">Output Items</label>
                      <button onClick={() => addOutputItem(idx)} className="text-[9px] text-amber-400 hover:text-amber-300">+ Add</button>
                    </div>
                    {stage.outputItems.map((item, oi) => (
                      <div key={oi} className="flex gap-1 mb-1">
                        <input className={smallInputClass + ' flex-1'} placeholder="item" value={item.item} onChange={(e) => updateOutputItem(idx, oi, { item: e.target.value })} />
                        <input className={smallInputClass + ' w-12'} placeholder="qty" value={item.count} onChange={(e) => updateOutputItem(idx, oi, { count: e.target.value })} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Loop toggle */}
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={loop}
            onChange={(e) => setLoop(e.target.checked)}
            className="w-4 h-4 rounded bg-zinc-800 border-zinc-700 text-amber-500 focus:ring-amber-500/30"
          />
          <span className="text-xs text-zinc-400">Loop chain (restart after completion)</span>
        </label>

        {error && <p className="text-xs text-red-400">{error}</p>}

        <button
          onClick={handleCreate}
          disabled={creating}
          className="w-full py-2.5 rounded-lg text-xs font-semibold bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {creating ? 'Creating...' : 'Create Chain'}
        </button>
      </div>
    </motion.div>
  );
}

function ChainDetail({
  chain,
  mission,
  onBack,
  onStart,
  onPause,
  onCancel,
}: {
  chain: SupplyChain;
  mission?: MissionRecord | null;
  onBack: () => void;
  onStart: () => void;
  onPause: () => void;
  onCancel: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
    >
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="p-2 rounded-lg bg-zinc-800/60 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-white">{chain.name}</h2>
          {chain.description && <p className="text-xs text-zinc-400 mt-0.5">{chain.description}</p>}
        </div>
        <StatusBadge status={chain.status} colors={CHAIN_STATUS_COLORS} />
      </div>

      {/* Mission status */}
      {mission && (
        <div className="flex items-center gap-3 bg-zinc-800/40 rounded-lg px-3 py-2 mb-4">
          <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Mission</span>
          <span className="text-xs text-zinc-300 font-medium">{mission.title}</span>
          <StatusBadge status={mission.status} colors={MISSION_STATUS_COLORS} />
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 mb-6">
        {(chain.status === 'idle' || chain.status === 'paused') && (
          <button
            onClick={onStart}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors"
          >
            Start
          </button>
        )}
        {chain.status === 'running' && (
          <button
            onClick={onPause}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-zinc-700/80 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Pause
          </button>
        )}
        {(chain.status === 'running' || chain.status === 'paused') && (
          <button
            onClick={onCancel}
            className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Cancel
          </button>
        )}
        {chain.loop && (
          <span className="ml-2 px-2 py-1 text-[10px] font-medium rounded bg-amber-500/10 text-amber-400">
            Looping
          </span>
        )}
      </div>

      {/* Flow visualization */}
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-6 overflow-x-auto">
        <div className="flex items-center gap-0 min-w-max">
          {chain.stages.map((stage, i) => (
            <div key={stage.id} className="flex items-center">
              <StageCard
                stage={stage}
                index={i}
                isActive={i === chain.currentStageIndex && chain.status === 'running'}
              />
              {i < chain.stages.length - 1 && <StageArrow />}
            </div>
          ))}
          {chain.loop && chain.stages.length > 0 && (
            <div className="shrink-0 flex items-center ml-1">
              <div className="w-6 h-0.5 bg-amber-500/40" />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50">
                <polyline points="23 4 23 10 17 10" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

export default function ChainsPage() {
  const [chains, setLocalChains] = useState<SupplyChain[]>([]);
  const [templates, setTemplates] = useState<ChainTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedChainId, setSelectedChainId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chainMissions, setChainMissions] = useState<Record<string, MissionRecord>>({});

  const botList = useBotStore((s) => s.botList);
  const setStoreChains = useBotStore((s) => s.setChains);

  const botNames = botList.map((b) => b.name);

  const fetchChains = useCallback(async () => {
    try {
      const data = await api.getChains();
      setLocalChains(data.chains);
      setStoreChains(data.chains);
    } catch {
      // API may not exist yet
      setLocalChains([]);
    }
  }, [setStoreChains]);

  const fetchTemplates = useCallback(async () => {
    try {
      const data = await api.getChainTemplates();
      setTemplates(data.templates);
    } catch {
      setTemplates([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([fetchChains(), fetchTemplates()]);
      if (!cancelled) {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchChains, fetchTemplates]);

  const selectedChain = chains.find((c) => c.id === selectedChainId) ?? null;

  const handleStart = async (id: string) => {
    try {
      await api.startChain(id);
      await fetchChains();

      // Create a mission for this chain
      const chain = chains.find((c) => c.id === id);
      if (chain) {
        const stageBotNames = [...new Set(chain.stages.map((s) => s.botName))];
        try {
          const missionResult = await api.createMission({
            type: 'supply_chain',
            title: chain.name,
            description: chain.description || `Supply chain with ${chain.stages.length} stage(s)`,
            assigneeType: 'bot',
            assigneeIds: stageBotNames,
            priority: 'normal',
            source: 'dashboard',
          });
          setChainMissions((prev) => ({ ...prev, [id]: missionResult.mission }));
        } catch {
          // Mission creation is best-effort
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start chain');
    }
  };

  const handlePause = async (id: string) => {
    try {
      await api.pauseChain(id);
      await fetchChains();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to pause chain');
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await api.cancelChain(id);
      await fetchChains();
      // Also cancel linked mission
      const mission = chainMissions[id];
      if (mission) {
        try { await api.cancelMission(mission.id); } catch {}
        setChainMissions((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to cancel chain');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteChain(id);
      await fetchChains();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resume chain');
    }
  };

  const handleCreated = () => {
    setShowCreate(false);
    fetchChains();
  };

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Supply Chains" subtitle="Automate multi-bot production pipelines" />
        <div className="flex items-center justify-center h-64">
          <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader title="Supply Chains" subtitle="Automate multi-bot production pipelines" />

      {error && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400"
        >
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-300 hover:text-white">dismiss</button>
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {selectedChain ? (
          <ChainDetail
            key="detail"
            chain={selectedChain}
            mission={chainMissions[selectedChain.id]}
            onBack={() => setSelectedChainId(null)}
            onStart={() => handleStart(selectedChain.id)}
            onPause={() => handlePause(selectedChain.id)}
            onCancel={() => handleCancel(selectedChain.id)}
          />
        ) : (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {/* Header with create button */}
            <div className="flex items-center justify-between mb-5">
              <p className="text-xs text-zinc-500">{chains.length} chain{chains.length !== 1 ? 's' : ''}</p>
              <button
                onClick={() => setShowCreate(!showCreate)}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors"
              >
                {showCreate ? 'Cancel' : 'Create Chain'}
              </button>
            </div>

            <AnimatePresence>
              {showCreate && (
                <div className="mb-6">
                  <CreateChainForm
                    templates={templates}
                    botNames={botNames}
                    onCreated={handleCreated}
                    onCancel={() => setShowCreate(false)}
                  />
                </div>
              )}
            </AnimatePresence>

            {/* Chain list */}
            {chains.length === 0 && !showCreate ? (
              <div className="flex flex-col items-center justify-center h-48 text-zinc-500">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-40">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <p className="text-xs">No supply chains yet</p>
                <p className="text-[10px] text-zinc-600 mt-1">Create one to automate bot production</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <AnimatePresence>
                  {chains.map((chain) => (
                    <ChainCard
                      key={chain.id}
                      chain={chain}
                      mission={chainMissions[chain.id]}
                      onSelect={() => setSelectedChainId(chain.id)}
                      onStart={() => handleStart(chain.id)}
                      onPause={() => handlePause(chain.id)}
                      onCancel={() => handleCancel(chain.id)}
                      onDelete={() => handleDelete(chain.id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
