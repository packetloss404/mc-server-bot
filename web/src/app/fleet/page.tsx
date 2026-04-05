'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useBotStore } from '@/lib/store';
import { api } from '@/lib/api';
import { getPersonalityColor, STATE_COLORS, STATE_LABELS, PERSONALITY_ICONS } from '@/lib/constants';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonCardGrid } from '@/components/SkeletonLoader';
import { useToast } from '@/components/Toast';

export default function FleetPage() {
  const bots = useBotStore((s) => s.botList);
  const connected = useBotStore((s) => s.connected);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    // Give the socket a moment to populate bots
    const timer = setTimeout(() => setLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (bots.length > 0) setLoading(false);
  }, [bots.length]);

  const activeBots = bots.filter((b) => b.state !== 'IDLE' && b.state !== 'DISCONNECTED');
  const idleBots = bots.filter((b) => b.state === 'IDLE');

  const handlePauseAll = async () => {
    try {
      await Promise.all(bots.map((b) => api.pauseBot(b.name).catch(() => {})));
      toast('All bots paused', 'success');
    } catch {
      toast('Failed to pause some bots', 'error');
    }
  };

  const handleResumeAll = async () => {
    try {
      await Promise.all(bots.map((b) => api.resumeBot(b.name).catch(() => {})));
      toast('All bots resumed', 'success');
    } catch {
      toast('Failed to resume some bots', 'error');
    }
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
      <PageHeader title="Fleet" subtitle={`${bots.length} bots${activeBots.length > 0 ? ` -- ${activeBots.length} active` : ''}`}>
        {bots.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={handlePauseAll}
              className="text-xs bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors border border-zinc-700/50"
              title="Pause all bots"
            >
              Pause All
            </button>
            <button
              onClick={handleResumeAll}
              className="text-xs bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 px-3 py-1.5 rounded-lg transition-colors border border-emerald-600/30"
              title="Resume all bots"
            >
              Resume All
            </button>
          </div>
        )}
      </PageHeader>

      {loading ? (
        <SkeletonCardGrid count={4} />
      ) : bots.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40"
        >
          <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <p className="text-sm text-zinc-500">No bots in your fleet</p>
          <p className="text-xs text-zinc-600 mt-1">
            <Link href="/manage" className="text-emerald-500 hover:text-emerald-400">Create a bot</Link> to get started
          </p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {bots.map((bot, i) => {
            const color = getPersonalityColor(bot.personality);
            const stateColor = STATE_COLORS[bot.state] ?? '#6B7280';
            const emoji = PERSONALITY_ICONS[bot.personality?.toLowerCase()] ?? '';
            return (
              <motion.div
                key={bot.name}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
              >
                <Link
                  href={`/bots/${bot.name}`}
                  className="block bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 hover:bg-zinc-800/40 transition-colors group"
                >
                  <div className="h-0.5 -mt-4 -mx-4 mb-4 rounded-t-xl" style={{ background: `linear-gradient(90deg, ${color}, ${color}40)` }} />
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0"
                      style={{ backgroundColor: `${color}12` }}
                    >
                      {emoji}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white group-hover:text-emerald-400 transition-colors">{bot.name}</span>
                        <span className="text-[10px] capitalize text-zinc-500">{bot.personality}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-medium uppercase flex items-center gap-1" style={{ color: stateColor }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: stateColor }} />
                          {STATE_LABELS[bot.state] ?? bot.state}
                        </span>
                        {bot.position && (
                          <span className="text-[10px] text-zinc-600 font-mono">
                            {Math.round(bot.position.x)}, {Math.round(bot.position.z)}
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-md border"
                      style={{
                        color: bot.mode === 'codegen' ? '#10B981' : '#F59E0B',
                        borderColor: bot.mode === 'codegen' ? '#10B98130' : '#F59E0B30',
                        backgroundColor: bot.mode === 'codegen' ? '#10B98108' : '#F59E0B08',
                      }}
                    >
                      {bot.mode}
                    </span>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
