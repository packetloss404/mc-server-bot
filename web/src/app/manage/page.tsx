'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useBotStore } from '@/lib/store';
import { api } from '@/lib/api';
import { getPersonalityColor, STATE_COLORS, STATE_LABELS, PERSONALITY_ICONS } from '@/lib/constants';
import { PageHeader } from '@/components/PageHeader';

const PERSONALITIES = ['merchant', 'guard', 'elder', 'explorer', 'blacksmith', 'farmer', 'builder'];

export default function ManagePage() {
  const bots = useBotStore((s) => s.botList);
  const [newName, setNewName] = useState('');
  const [newPersonality, setNewPersonality] = useState('merchant');
  const [newMode, setNewMode] = useState('codegen');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [taskBot, setTaskBot] = useState<string | null>(null);
  const [taskDesc, setTaskDesc] = useState('');

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    setSuccess(null);
    try {
      await api.createBot(newName.trim(), newPersonality, newMode);
      setSuccess(`Bot "${newName.trim()}" created successfully`);
      setNewName('');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
    setCreating(false);
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Remove ${name}? This action cannot be undone.`)) return;
    setError(null);
    try {
      await api.deleteBot(name);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleModeToggle = async (name: string, currentMode: string) => {
    const mode = currentMode === 'codegen' ? 'primitive' : 'codegen';
    try {
      await api.setMode(name, mode);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleQueueTask = async (botName: string) => {
    if (!taskDesc.trim()) return;
    try {
      await api.queueTask(botName, taskDesc.trim());
      setTaskDesc('');
      setTaskBot(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-5xl">
      <PageHeader title="Bot Management" subtitle="Create, configure, and manage your AI bots" />

      {/* Messages */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 px-4 py-2.5 rounded-lg flex items-center justify-between"
        >
          {error}
          <button onClick={() => setError(null)} className="text-red-400/50 hover:text-red-400 ml-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
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

      {/* Create Bot */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
      >
        <h2 className="text-sm font-semibold text-white mb-4">Create New Bot</h2>

        {/* Personality picker */}
        <div className="grid grid-cols-7 gap-2 mb-4">
          {PERSONALITIES.map((p) => {
            const color = getPersonalityColor(p);
            const isSelected = newPersonality === p;
            return (
              <button
                key={p}
                onClick={() => setNewPersonality(p)}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${
                  isSelected
                    ? 'border-zinc-500 bg-zinc-800/80 scale-105'
                    : 'border-zinc-800/60 hover:border-zinc-700 hover:bg-zinc-800/40'
                }`}
                style={isSelected ? { borderColor: `${color}60`, backgroundColor: `${color}08` } : {}}
              >
                <span className="text-lg">{PERSONALITY_ICONS[p]}</span>
                <span
                  className="text-[10px] font-medium capitalize"
                  style={{ color: isSelected ? color : '#6B7280' }}
                >
                  {p}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="Bot name..."
            className="flex-1 min-w-[200px] bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600"
          />
          <select
            value={newMode}
            onChange={(e) => setNewMode(e.target.value)}
            className="bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-white"
          >
            <option value="codegen">Codegen Mode</option>
            <option value="primitive">Primitive Mode</option>
          </select>
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {creating ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating...
              </span>
            ) : (
              'Create Bot'
            )}
          </button>
        </div>
      </motion.div>

      {/* Bot List */}
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800/60 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">Active Bots ({bots.length})</h2>
        </div>
        {bots.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-zinc-500">No bots created yet</p>
            <p className="text-xs text-zinc-600 mt-1">Create your first bot above</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {bots.map((bot, i) => {
              const color = getPersonalityColor(bot.personality);
              const stateColor = STATE_COLORS[bot.state] ?? '#6B7280';
              const emoji = PERSONALITY_ICONS[bot.personality?.toLowerCase()] ?? '';
              return (
                <motion.div
                  key={bot.name}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="px-5 py-3 hover:bg-zinc-800/20 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-sm shrink-0"
                      style={{ backgroundColor: `${color}12` }}
                    >
                      {emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/bots/${bot.name}`}
                          className="text-sm font-medium text-white hover:underline"
                        >
                          {bot.name}
                        </Link>
                        <span className="text-[10px] capitalize text-zinc-500">{bot.personality}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span
                          className="text-[10px] font-medium uppercase flex items-center gap-1"
                          style={{ color: stateColor }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stateColor }} />
                          {STATE_LABELS[bot.state] ?? bot.state}
                        </span>
                        {bot.position && (
                          <span className="text-[10px] text-zinc-600 font-mono">
                            {Math.round(bot.position.x)}, {Math.round(bot.position.y)}, {Math.round(bot.position.z)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleModeToggle(bot.name, bot.mode)}
                        className="text-[10px] font-mono font-medium px-2.5 py-1 rounded-md border transition-colors"
                        style={{
                          color: bot.mode === 'codegen' ? '#10B981' : '#F59E0B',
                          borderColor: bot.mode === 'codegen' ? '#10B98130' : '#F59E0B30',
                          backgroundColor: bot.mode === 'codegen' ? '#10B98108' : '#F59E0B08',
                        }}
                      >
                        {bot.mode}
                      </button>
                      <button
                        onClick={() => setTaskBot(taskBot === bot.name ? null : bot.name)}
                        className="text-xs text-zinc-500 hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-zinc-800 transition-colors"
                        title="Queue task"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(bot.name)}
                        className="text-xs text-zinc-600 hover:text-red-400 px-2 py-1 rounded-md hover:bg-zinc-800 transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {/* Task input */}
                  {taskBot === bot.name && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      className="flex gap-2 mt-3 pl-13"
                    >
                      <input
                        value={taskDesc}
                        onChange={(e) => setTaskDesc(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleQueueTask(bot.name)}
                        placeholder={`Queue a task for ${bot.name}...`}
                        className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
                        autoFocus
                      />
                      <button
                        onClick={() => handleQueueTask(bot.name)}
                        disabled={!taskDesc.trim()}
                        className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      >
                        Queue
                      </button>
                    </motion.div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
