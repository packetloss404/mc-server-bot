'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useBotStore } from '@/lib/store';
import { PageHeader } from '@/components/PageHeader';
import { LoadingSpinner } from '@/components/SkeletonLoader';
import { useToast } from '@/components/Toast';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function CommanderPage() {
  const bots = useBotStore((s) => s.botList);
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [parsing, setParsing] = useState(false);
  const [plan, setPlan] = useState<any>(null);
  const [executing, setExecuting] = useState(false);
  const [history, setHistory] = useState<{ input: string; result: string; ok: boolean; time: number }[]>([]);

  const handleParse = async () => {
    if (!input.trim()) return;
    setParsing(true);
    setPlan(null);
    try {
      const res = await fetch(`${API_BASE}/api/commander/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: input.trim() }),
      });
      if (!res.ok) throw new Error('Parse failed');
      const data = await res.json();
      setPlan(data.plan);
      toast('Command parsed', 'success');
    } catch (e: any) {
      toast(e.message || 'Failed to parse command', 'error');
    }
    setParsing(false);
  };

  const handleExecute = async () => {
    if (!plan) return;
    setExecuting(true);
    try {
      const res = await fetch(`${API_BASE}/api/commander/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) throw new Error('Execution failed');
      setHistory((prev) => [{ input, result: 'Executed successfully', ok: true, time: Date.now() }, ...prev]);
      toast('Command executed', 'success');
      setInput('');
      setPlan(null);
    } catch (e: any) {
      setHistory((prev) => [{ input, result: e.message || 'Failed', ok: false, time: Date.now() }, ...prev]);
      toast(e.message || 'Execution failed', 'error');
    }
    setExecuting(false);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-4xl">
      <PageHeader title="Commander" subtitle="Natural language fleet control" />

      {/* Input */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
      >
        <h2 className="text-sm font-semibold text-white mb-3">Issue a Command</h2>
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleParse()}
            placeholder='e.g. "Send all bots to guard the base" or "Have Farmer1 collect wood"'
            className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600"
          />
          <button
            onClick={handleParse}
            disabled={parsing || !input.trim()}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            {parsing ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Parsing...
              </span>
            ) : 'Parse'}
          </button>
        </div>
        {bots.length === 0 && (
          <p className="text-xs text-zinc-600 mt-2">
            No bots online. <Link href="/manage" className="text-emerald-500 hover:text-emerald-400">Create one</Link> first.
          </p>
        )}
      </motion.div>

      {/* Parsed Plan */}
      {plan && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-white">Parsed Plan</h2>
            <button
              onClick={handleExecute}
              disabled={executing}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
            >
              {executing ? 'Executing...' : 'Execute Plan'}
            </button>
          </div>
          <pre className="text-xs text-zinc-400 bg-zinc-950/50 rounded-lg p-3 overflow-auto max-h-64 font-mono">
            {JSON.stringify(plan, null, 2)}
          </pre>
        </motion.div>
      )}

      {/* Command History */}
      <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800/60">
          <h2 className="text-sm font-semibold text-zinc-300">Command History</h2>
        </div>
        {history.length === 0 ? (
          <div className="py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5 12 2" />
                <line x1="12" y1="22" x2="12" y2="15.5" />
                <polyline points="22 8.5 12 15.5 2 8.5" />
              </svg>
            </div>
            <p className="text-sm text-zinc-500">No commands issued yet</p>
            <p className="text-xs text-zinc-600 mt-1">Type a natural language command above to get started</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/30">
            {history.map((item, i) => (
              <div key={i} className="px-5 py-3 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${item.ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  <span className="text-zinc-300 font-medium">{item.input}</span>
                  <span className="text-zinc-600 ml-auto font-mono">{new Date(item.time).toLocaleTimeString()}</span>
                </div>
                <p className={`text-[11px] ml-3.5 ${item.ok ? 'text-zinc-500' : 'text-red-400/70'}`}>{item.result}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
