'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api, MissionTemplate, TemplateField } from '@/lib/api';
import { useBotStore } from '@/lib/store';

const CATEGORY_COLORS: Record<string, string> = {
  combat: '#EF4444',
  gathering: '#10B981',
  crafting: '#F59E0B',
  logistics: '#3B82F6',
  building: '#8B5CF6',
};

const CATEGORY_ICONS: Record<string, string> = {
  combat: '\u2694',
  gathering: '\u26CF',
  crafting: '\u2692',
  logistics: '\u{1F4E6}',
  building: '\u{1F3D7}',
};

const PRIORITY_OPTIONS = ['low', 'normal', 'high', 'critical'];

interface Props {
  onMissionCreated?: () => void;
}

export function MissionComposer({ onMissionCreated }: Props) {
  const [templates, setTemplates] = useState<MissionTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<MissionTemplate | null>(null);
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [assignees, setAssignees] = useState<string[]>([]);
  const [priority, setPriority] = useState('normal');
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  const bots = useBotStore((s) => s.botList);

  const loadTemplates = useCallback(async () => {
    try {
      const { templates: t } = await api.getTemplates();
      setTemplates(t);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  const handleSelectTemplate = (t: MissionTemplate) => {
    setSelectedTemplate(t);
    // Pre-fill defaults
    const defaults: Record<string, unknown> = {};
    for (const field of t.requiredFields) {
      if (field.default !== undefined) defaults[field.name] = field.default;
    }
    if (t.optionalFields) {
      for (const field of t.optionalFields) {
        if (field.default !== undefined) defaults[field.name] = field.default;
      }
    }
    setParams({ ...t.defaultParams, ...defaults });
    setAssignees([]);
    setPriority('normal');
    setFeedback(null);
  };

  const handleParamChange = (name: string, value: unknown) => {
    setParams((prev) => ({ ...prev, [name]: value }));
  };

  const toggleAssignee = (botName: string) => {
    setAssignees((prev) =>
      prev.includes(botName) ? prev.filter((b) => b !== botName) : [...prev, botName],
    );
  };

  const handleExecute = async () => {
    if (!selectedTemplate || assignees.length === 0) return;
    setLoading(true);
    setFeedback(null);
    try {
      const result = await api.executeTemplate(selectedTemplate.id, params, assignees, priority);
      const failedBots = result.results.filter((r) => !r.queued);
      if (failedBots.length > 0) {
        setFeedback({
          msg: `Mission sent. ${failedBots.length} bot(s) failed: ${failedBots.map((f) => f.bot).join(', ')}`,
          ok: false,
        });
      } else {
        setFeedback({ msg: `Mission "${selectedTemplate.name}" dispatched to ${assignees.length} bot(s)`, ok: true });
        onMissionCreated?.();
      }
    } catch (e: any) {
      setFeedback({ msg: e.message || 'Failed to execute template', ok: false });
    }
    setLoading(false);
    setTimeout(() => setFeedback(null), 5000);
  };

  const handleBack = () => {
    setSelectedTemplate(null);
    setParams({});
    setAssignees([]);
    setFeedback(null);
  };

  const filteredTemplates = filterCategory
    ? templates.filter((t) => t.category === filterCategory)
    : templates;

  const categories = Array.from(new Set(templates.map((t) => t.category)));

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {selectedTemplate && (
            <button
              onClick={handleBack}
              className="text-zinc-500 hover:text-zinc-300 transition-colors mr-1"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          <h2 className="text-sm font-semibold text-zinc-300">
            {selectedTemplate ? selectedTemplate.name : 'Quick Mission'}
          </h2>
        </div>
        {!selectedTemplate && (
          <span className="text-[10px] text-zinc-600">{templates.length} templates</span>
        )}
      </div>

      {/* Feedback */}
      <AnimatePresence>
        {feedback && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={`text-xs px-5 py-2 ${feedback.ok ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}
          >
            {feedback.msg}
          </motion.div>
        )}
      </AnimatePresence>

      {!selectedTemplate ? (
        /* ─── Template Picker ───────────────────────────────── */
        <div className="p-4">
          {/* Category filter */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <button
              onClick={() => setFilterCategory(null)}
              className={`text-[10px] px-2.5 py-1 rounded-md font-medium transition-colors ${
                !filterCategory ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
                className="text-[10px] px-2.5 py-1 rounded-md font-medium transition-colors flex items-center gap-1"
                style={{
                  color: filterCategory === cat ? CATEGORY_COLORS[cat] : '#6B7280',
                  backgroundColor: filterCategory === cat ? `${CATEGORY_COLORS[cat]}15` : 'transparent',
                }}
              >
                <span>{CATEGORY_ICONS[cat]}</span>
                <span className="capitalize">{cat}</span>
              </button>
            ))}
          </div>

          {/* Template grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {filteredTemplates.map((t) => {
              const color = CATEGORY_COLORS[t.category] || '#6B7280';
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectTemplate(t)}
                  className="text-left p-3 rounded-lg border border-zinc-800/60 hover:border-zinc-700 hover:bg-zinc-800/40 transition-all group"
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className="w-7 h-7 rounded-md flex items-center justify-center text-xs shrink-0 mt-0.5"
                      style={{ backgroundColor: `${color}15`, color }}
                    >
                      {CATEGORY_ICONS[t.category]}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-white group-hover:text-emerald-300 transition-colors">
                          {t.name}
                        </span>
                        {t.builtIn && (
                          <span className="text-[9px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">built-in</span>
                        )}
                      </div>
                      <p className="text-[10px] text-zinc-500 mt-0.5 line-clamp-2">{t.description}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[9px] text-zinc-600 capitalize">{t.category}</span>
                        <span className="text-zinc-800">|</span>
                        <span className="text-[9px] text-zinc-600">{t.suggestedBotCount} bot(s) suggested</span>
                        {t.loadoutPolicy?.requiredItems && (
                          <>
                            <span className="text-zinc-800">|</span>
                            <span className="text-[9px] text-amber-600">loadout required</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {filteredTemplates.length === 0 && (
            <p className="text-xs text-zinc-600 text-center py-6">No templates found</p>
          )}
        </div>
      ) : (
        /* ─── Template Configuration Form ───────────────────── */
        <div className="p-4 space-y-4">
          {/* Description */}
          <p className="text-xs text-zinc-400">{selectedTemplate.description}</p>

          {/* Loadout policy notice */}
          {selectedTemplate.loadoutPolicy?.requiredItems && selectedTemplate.loadoutPolicy.requiredItems.length > 0 && (
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
              <p className="text-[10px] font-medium text-amber-400 mb-1">Required Loadout</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedTemplate.loadoutPolicy.requiredItems.map((item) => (
                  <span
                    key={item.name}
                    className="text-[10px] bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded-md"
                  >
                    {item.name} x{item.count}
                  </span>
                ))}
                {selectedTemplate.loadoutPolicy.equipBestArmor && (
                  <span className="text-[10px] bg-amber-500/10 text-amber-300 px-2 py-0.5 rounded-md">
                    best armor
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Required fields */}
          <div className="space-y-3">
            <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Parameters</h3>
            {selectedTemplate.requiredFields.map((field) => (
              <FieldInput
                key={field.name}
                field={field}
                value={params[field.name]}
                onChange={(val) => handleParamChange(field.name, val)}
                required
              />
            ))}
          </div>

          {/* Optional fields */}
          {selectedTemplate.optionalFields && selectedTemplate.optionalFields.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Options</h3>
              {selectedTemplate.optionalFields.map((field) => (
                <FieldInput
                  key={field.name}
                  field={field}
                  value={params[field.name]}
                  onChange={(val) => handleParamChange(field.name, val)}
                />
              ))}
            </div>
          )}

          {/* Assignees */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
              Assign to Bots
              <span className="text-zinc-600 normal-case ml-1">
                (suggested: {selectedTemplate.suggestedBotCount})
              </span>
            </h3>
            {bots.length === 0 ? (
              <p className="text-[10px] text-zinc-600">No bots online</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {bots.map((bot) => {
                  const selected = assignees.includes(bot.name);
                  return (
                    <button
                      key={bot.name}
                      onClick={() => toggleAssignee(bot.name)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
                        selected
                          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                          : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                      }`}
                    >
                      {bot.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Priority */}
          <div className="space-y-2">
            <h3 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">Priority</h3>
            <div className="flex gap-1.5">
              {PRIORITY_OPTIONS.map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`text-[10px] px-2.5 py-1 rounded-md font-medium capitalize transition-colors ${
                    priority === p
                      ? p === 'critical' ? 'bg-red-500/15 text-red-400'
                        : p === 'high' ? 'bg-orange-500/15 text-orange-400'
                        : p === 'low' ? 'bg-zinc-700 text-zinc-300'
                        : 'bg-emerald-500/15 text-emerald-400'
                      : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Execute button */}
          <button
            onClick={handleExecute}
            disabled={loading || assignees.length === 0}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Dispatching...
              </span>
            ) : (
              `Dispatch Mission to ${assignees.length} Bot${assignees.length !== 1 ? 's' : ''}`
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Field Input Component ─────────────────────────────────────────

function FieldInput({
  field,
  value,
  onChange,
  required,
}: {
  field: TemplateField;
  value: unknown;
  onChange: (val: unknown) => void;
  required?: boolean;
}) {
  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 cursor-pointer group">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="w-3.5 h-3.5 rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/30"
        />
        <span className="text-xs text-zinc-300 group-hover:text-white transition-colors">{field.label}</span>
        {field.description && (
          <span className="text-[10px] text-zinc-600">- {field.description}</span>
        )}
      </label>
    );
  }

  if (field.type === 'number') {
    return (
      <div>
        <label className="text-[10px] text-zinc-400 block mb-1">
          {field.label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
          {field.description && <span className="text-zinc-600 ml-1">({field.description})</span>}
        </label>
        <input
          type="number"
          value={value !== undefined && value !== null ? String(value) : ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 font-mono"
          placeholder={field.default !== undefined ? String(field.default) : ''}
        />
      </div>
    );
  }

  if (field.type === 'position') {
    const strVal = value !== undefined && value !== null ? String(value) : '';
    return (
      <div>
        <label className="text-[10px] text-zinc-400 block mb-1">
          {field.label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
          {field.description && <span className="text-zinc-600 ml-1">({field.description})</span>}
        </label>
        <input
          type="text"
          value={strVal}
          onChange={(e) => onChange(e.target.value)}
          placeholder="x, y, z"
          className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600 font-mono"
        />
      </div>
    );
  }

  // Default: string / string[]
  if (field.options && field.options.length > 0) {
    return (
      <div>
        <label className="text-[10px] text-zinc-400 block mb-1">
          {field.label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white"
        >
          <option value="">Select...</option>
          {field.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div>
      <label className="text-[10px] text-zinc-400 block mb-1">
        {field.label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
        {field.description && <span className="text-zinc-600 ml-1">({field.description})</span>}
      </label>
      <input
        type="text"
        value={value !== undefined && value !== null ? String(value) : ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
        placeholder={field.default !== undefined ? String(field.default) : ''}
      />
    </div>
  );
}
