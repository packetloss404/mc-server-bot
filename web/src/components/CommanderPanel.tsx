'use client';

import { useState } from 'react';
import { api, type CommanderPlan } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { useBotStore } from '@/lib/store';

export function CommanderPanel() {
  const { toast } = useToast();
  const bots = useBotStore((s) => s.botList);
  const [input, setInput] = useState('');
  const [plan, setPlan] = useState<CommanderPlan | null>(null);
  const [parsing, setParsing] = useState(false);
  const [executing, setExecuting] = useState(false);

  const handleParse = async () => {
    if (!input.trim()) return;
    setParsing(true);
    setPlan(null);
    try {
      const res = await api.commanderParse(input.trim());
      setPlan(res.plan);
    } catch (e: unknown) {
      toast((e as Error).message || 'Failed to parse command', 'error');
    }
    setParsing(false);
  };

  const handleExecute = async () => {
    if (!plan) return;
    setExecuting(true);
    try {
      await api.commanderExecute(plan);
      toast('Plan executed successfully', 'success');
      setPlan(null);
      setInput('');
    } catch (e: unknown) {
      toast((e as Error).message || 'Execution failed', 'error');
    }
    setExecuting(false);
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5">
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">
        Natural Language Commander
      </h2>

      <div className="space-y-4">
        {/* Input */}
        <div>
          <div className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleParse()}
              placeholder={`Tell your bots what to do... (${bots.length} bot${bots.length !== 1 ? 's' : ''} online)`}
              className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600 transition-colors"
            />
            <button
              onClick={handleParse}
              disabled={parsing || !input.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2.5 rounded-lg text-xs font-medium transition-colors shrink-0"
            >
              {parsing ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Parsing...
                </span>
              ) : (
                'Parse'
              )}
            </button>
          </div>
          <p className="text-[10px] text-zinc-600 mt-1.5">
            Examples: &quot;Send all guards to patrol the village&quot;, &quot;Have Farmer_01 harvest wheat&quot;
          </p>
        </div>

        {/* Plan preview */}
        {plan && (
          <div className="border border-zinc-800/60 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 bg-zinc-800/40 border-b border-zinc-800/60 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-zinc-300">Parsed Plan</p>
                <p className="text-[10px] text-zinc-500 mt-0.5">{plan.intent}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setPlan(null)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded transition-colors"
                >
                  Discard
                </button>
                <button
                  onClick={handleExecute}
                  disabled={executing}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white px-3 py-1 rounded-lg text-xs font-medium transition-colors"
                >
                  {executing ? 'Executing...' : 'Execute'}
                </button>
              </div>
            </div>

            <div className="p-4 space-y-3">
              {plan.commands.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                    Commands ({plan.commands.length})
                  </p>
                  <div className="space-y-1">
                    {plan.commands.map((cmd, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-emerald-400 font-mono">{cmd.type}</span>
                        <span className="text-zinc-500">-&gt;</span>
                        <span className="text-zinc-300">{cmd.botName}</span>
                        {Object.keys(cmd.params).length > 0 && (
                          <span className="text-zinc-600 font-mono text-[10px]">
                            {JSON.stringify(cmd.params)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {plan.missions.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-1.5">
                    Missions ({plan.missions.length})
                  </p>
                  <div className="space-y-1">
                    {plan.missions.map((m, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <span className="text-blue-400 font-mono">{m.type}</span>
                        <span className="text-zinc-500">-&gt;</span>
                        <span className="text-zinc-300">{m.botName}</span>
                        <span className="text-zinc-500 truncate">{m.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
