'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useBotStore } from '@/lib/store';
import { useToast } from '@/components/Toast';

const MISSION_TYPES = [
  { value: 'queue_task', label: 'Queue Task', description: 'Run a voyager task' },
  { value: 'patrol', label: 'Patrol', description: 'Patrol a zone or route' },
  { value: 'gather', label: 'Gather', description: 'Gather resources' },
  { value: 'build', label: 'Build', description: 'Build a structure' },
  { value: 'guard', label: 'Guard', description: 'Guard an area' },
  { value: 'explore', label: 'Explore', description: 'Explore the world' },
];

const PRIORITIES = [
  { value: 1, label: 'Low', color: '#6B7280' },
  { value: 5, label: 'Normal', color: '#3B82F6' },
  { value: 8, label: 'High', color: '#F59E0B' },
  { value: 10, label: 'Urgent', color: '#EF4444' },
];

export function MissionComposer() {
  const { toast } = useToast();
  const bots = useBotStore((s) => s.botList);
  const [type, setType] = useState('queue_task');
  const [botName, setBotName] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleSubmit = async () => {
    if (!botName || !description.trim()) return;
    setSubmitting(true);
    try {
      await api.createMission(type, botName, description.trim(), priority);
      toast(`Mission created for ${botName}`, 'success');
      setDescription('');
    } catch (e: unknown) {
      toast((e as Error).message || 'Failed to create mission', 'error');
    }
    setSubmitting(false);
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-3 flex items-center justify-between hover:bg-zinc-800/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Quick Mission</span>
        </div>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-zinc-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-3 border-t border-zinc-800/40">
          <div className="pt-3 grid grid-cols-2 gap-3">
            {/* Bot selector */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Bot</label>
              <select
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-600"
              >
                <option value="">Select bot...</option>
                {bots.map((b) => (
                  <option key={b.name} value={b.name}>{b.name}</option>
                ))}
              </select>
            </div>

            {/* Type selector */}
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Type</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-600"
              >
                {MISSION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Priority</label>
            <div className="flex gap-1.5">
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setPriority(p.value)}
                  className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
                    priority === p.value ? 'text-white' : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                  style={priority === p.value ? { backgroundColor: `${p.color}20`, color: p.color, border: `1px solid ${p.color}30` } : { border: '1px solid transparent' }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium block mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What should the bot do?"
              rows={2}
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting || !botName || !description.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white py-2 rounded-lg text-xs font-medium transition-colors"
          >
            {submitting ? 'Creating...' : 'Create Mission'}
          </button>
        </div>
      )}
    </div>
  );
}
