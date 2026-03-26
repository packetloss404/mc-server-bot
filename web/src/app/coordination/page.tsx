'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { useBotStore } from '@/lib/store';
import { PageHeader } from '@/components/PageHeader';

interface BlackboardMessage {
  id: string;
  botName: string;
  kind: string;
  text: string;
  createdAt: number;
}

interface BlackboardTask {
  id: string;
  description: string;
  status: string;
  assignedBot?: string;
  source: string;
  blocker?: string;
  createdAt: number;
  updatedAt: number;
}

interface BlackboardGoal {
  id: string;
  rawRequest: string;
  requestedBy: string;
  scope: string;
  botName?: string;
  status: string;
  createdAt: number;
}

const KIND_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  blocker: { label: 'blocker', color: '#EF4444', icon: '!' },
  progress: { label: 'progress', color: '#3B82F6', icon: '>' },
  completion: { label: 'completed', color: '#10B981', icon: '\u2713' },
  claim: { label: 'claimed', color: '#F59E0B', icon: '\u2192' },
  request_help: { label: 'help', color: '#A78BFA', icon: '?' },
  info: { label: 'info', color: '#6B7280', icon: 'i' },
};

const KIND_FILTERS = ['all', 'blocker', 'progress', 'completion', 'claim', 'request_help', 'info'];

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export default function CoordinationPage() {
  const activityFeed = useBotStore((s) => s.activityFeed);
  const [messages, setMessages] = useState<BlackboardMessage[]>([]);
  const [tasks, setTasks] = useState<BlackboardTask[]>([]);
  const [goals, setGoals] = useState<BlackboardGoal[]>([]);
  const [swarmGoal, setSwarmGoal] = useState<BlackboardGoal | null>(null);
  const [filter, setFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    const load = () => {
      api.getBlackboard().then((data) => {
        setMessages(data.blackboard.messages.slice().reverse());
        setTasks(data.blackboard.tasks);
        setGoals(data.blackboard.goals);
        setSwarmGoal(data.blackboard.swarmGoal);
      }).catch(() => {});
    };
    load();
    if (autoRefresh) {
      const interval = setInterval(load, 3000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const filteredMessages = messages.filter((m) => {
    if (kindFilter !== 'all' && m.kind !== kindFilter) return false;
    if (filter && !m.botName.toLowerCase().includes(filter.toLowerCase()) && !m.text.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const activeTasks = tasks.filter((t) => t.status === 'claimed' || t.status === 'pending');
  const blockedTasks = tasks.filter((t) => t.status === 'blocked');
  const commanderEvents = activityFeed.filter((event) => event.type === 'commander:parse' || event.type === 'commander:execute').slice(0, 8);

  return (
    <div className="p-6 lg:p-8 space-y-5 max-w-5xl">
      <PageHeader title="Coordination Feed" subtitle={`${filteredMessages.length} messages${filter || kindFilter !== 'all' ? ' (filtered)' : ''}`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              autoRefresh
                ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-zinc-600'}`} />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
        </div>
      </PageHeader>

      {/* Swarm Goal Banner */}
      {swarmGoal && swarmGoal.status === 'active' && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="text-emerald-400 text-sm font-bold shrink-0">SWARM GOAL</span>
          <span className="text-sm text-zinc-300">{swarmGoal.rawRequest}</span>
          <span className="text-[10px] text-zinc-500 ml-auto shrink-0">by {swarmGoal.requestedBy}</span>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 px-4 py-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Active Tasks</p>
          <p className="text-lg font-bold text-white mt-1">{activeTasks.length}</p>
        </div>
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 px-4 py-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Blocked</p>
          <p className="text-lg font-bold text-red-400 mt-1">{blockedTasks.length}</p>
        </div>
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 px-4 py-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Goals</p>
          <p className="text-lg font-bold text-white mt-1">{goals.filter((g) => g.status === 'active').length}</p>
        </div>
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 px-4 py-3">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider">Messages</p>
          <p className="text-lg font-bold text-white mt-1">{messages.length}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 max-w-xs">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search by bot or message..."
            className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {KIND_FILTERS.map((kind) => {
            const config = kind === 'all' ? null : KIND_CONFIG[kind];
            return (
              <button
                key={kind}
                onClick={() => setKindFilter(kind)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  kindFilter === kind
                    ? 'bg-zinc-700 text-white'
                    : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                }`}
                style={kindFilter === kind && config ? { color: config.color, backgroundColor: `${config.color}15` } : undefined}
              >
                {kind === 'all' ? 'All' : config?.label ?? kind}
              </button>
            );
          })}
        </div>
      </div>

      {/* Message Feed */}
      <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 overflow-hidden">
        {filteredMessages.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-zinc-500">No coordination messages{filter || kindFilter !== 'all' ? ' matching filters' : ' yet'}</p>
            {(filter || kindFilter !== 'all') && (
              <button
                onClick={() => { setFilter(''); setKindFilter('all'); }}
                className="text-xs text-zinc-500 hover:text-zinc-300 mt-2 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {filteredMessages.map((msg, i) => {
              const config = KIND_CONFIG[msg.kind] ?? KIND_CONFIG.info;
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.02, 0.5) }}
                  className="px-4 py-3 hover:bg-zinc-800/20 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                      style={{ color: config.color, backgroundColor: `${config.color}12` }}
                    >
                      {config.icon}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-white font-semibold">{msg.botName}</span>
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{ color: config.color, backgroundColor: `${config.color}15` }}
                        >
                          {config.label}
                        </span>
                        <span className="text-[10px] text-zinc-600 ml-auto shrink-0">{formatTimeAgo(msg.createdAt)}</span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{msg.text}</p>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {commanderEvents.length > 0 && (
        <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-800/30">
            <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Commander Activity</h2>
          </div>
          <div className="divide-y divide-zinc-800/30">
            {commanderEvents.map((event) => (
              <div key={`${event.type}-${event.timestamp}`} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-white">{event.type}</span>
                  <span className="text-[10px] text-zinc-600 ml-auto">{formatTimeAgo(event.timestamp)}</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1">{event.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
