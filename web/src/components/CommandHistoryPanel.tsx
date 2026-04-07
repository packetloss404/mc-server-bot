'use client';

import { useEffect, useState, useCallback } from 'react';
import { api, type Command, type Mission } from '@/lib/api';
import { useToast } from '@/components/Toast';

const STATUS_COLORS: Record<string, string> = {
  pending: '#F59E0B',
  dispatched: '#3B82F6',
  running: '#8B5CF6',
  active: '#8B5CF6',
  completed: '#10B981',
  failed: '#EF4444',
  cancelled: '#6B7280',
  paused: '#F59E0B',
};

interface Props {
  botName?: string;
}

export function CommandHistoryPanel({ botName }: Props) {
  const { toast } = useToast();
  const [commands, setCommands] = useState<Command[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [tab, setTab] = useState<'commands' | 'missions'>('commands');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [cmdRes, missRes] = await Promise.all([
        api.getCommands().catch(() => ({ commands: [] })),
        api.getMissions().catch(() => ({ missions: [] })),
      ]);
      let cmds = cmdRes.commands;
      let miss = missRes.missions;
      if (botName) {
        cmds = cmds.filter((c) => c.botName === botName);
        miss = miss.filter((m) => m.botName === botName);
      }
      setCommands(cmds.sort((a, b) => b.createdAt - a.createdAt));
      setMissions(miss.sort((a, b) => b.createdAt - a.createdAt));
    } catch {
      // silent
    }
    setLoading(false);
  }, [botName]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [load]);

  const handleCancelCommand = async (id: string) => {
    try {
      await api.cancelCommand(id);
      toast('Command cancelled', 'success');
      load();
    } catch (e: unknown) {
      toast((e as Error).message || 'Failed to cancel', 'error');
    }
  };

  const handleMissionAction = async (id: string, action: 'start' | 'pause' | 'resume' | 'cancel' | 'retry') => {
    try {
      await api.missionAction(id, action);
      toast(`Mission ${action}ed`, 'success');
      load();
    } catch (e: unknown) {
      toast((e as Error).message || `Failed to ${action}`, 'error');
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-zinc-800/60">
        <button
          onClick={() => setTab('commands')}
          className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
            tab === 'commands' ? 'text-white border-b-2 border-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Commands ({commands.length})
        </button>
        <button
          onClick={() => setTab('missions')}
          className={`flex-1 px-4 py-2.5 text-xs font-medium transition-colors ${
            tab === 'missions' ? 'text-white border-b-2 border-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Missions ({missions.length})
        </button>
      </div>

      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
          </div>
        ) : tab === 'commands' ? (
          commands.length === 0 ? (
            <p className="text-xs text-zinc-600 text-center py-6">No commands yet</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {commands.map((cmd) => (
                <div key={cmd.id} className="border border-zinc-800/40 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-zinc-300">{cmd.type}</span>
                      <span className="text-[10px] text-zinc-500">-&gt; {cmd.botName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                        style={{ color: STATUS_COLORS[cmd.status] || '#6B7280', backgroundColor: `${STATUS_COLORS[cmd.status] || '#6B7280'}15` }}
                      >
                        {cmd.status}
                      </span>
                      {(cmd.status === 'pending' || cmd.status === 'running') && (
                        <button
                          onClick={() => handleCancelCommand(cmd.id)}
                          className="text-[10px] text-zinc-500 hover:text-red-400 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-zinc-600 font-mono">{formatTime(cmd.createdAt)}</p>
                  {cmd.error && <p className="text-[10px] text-red-400/70 mt-1">{typeof cmd.error === 'string' ? cmd.error : ((cmd.error as { message?: string }).message ?? JSON.stringify(cmd.error))}</p>}
                </div>
              ))}
            </div>
          )
        ) : (
          missions.length === 0 ? (
            <p className="text-xs text-zinc-600 text-center py-6">No missions yet</p>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {missions.map((m) => (
                <div key={m.id} className="border border-zinc-800/40 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-zinc-300">{m.type}</span>
                      <span className="text-[10px] text-zinc-500">-&gt; {m.botName}</span>
                    </div>
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                      style={{ color: STATUS_COLORS[m.status] || '#6B7280', backgroundColor: `${STATUS_COLORS[m.status] || '#6B7280'}15` }}
                    >
                      {m.status}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 mt-1 truncate">{m.description}</p>
                  {m.progress !== undefined && (
                    <div className="h-1.5 bg-zinc-800 rounded-full mt-2 overflow-hidden">
                      <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${m.progress}%` }} />
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <p className="text-[10px] text-zinc-600 font-mono">{formatTime(m.createdAt)}</p>
                    <div className="flex gap-1.5">
                      {m.status === 'pending' && (
                        <ActionBtn label="Start" onClick={() => handleMissionAction(m.id, 'start')} />
                      )}
                      {m.status === 'active' && (
                        <ActionBtn label="Pause" onClick={() => handleMissionAction(m.id, 'pause')} />
                      )}
                      {m.status === 'paused' && (
                        <ActionBtn label="Resume" onClick={() => handleMissionAction(m.id, 'resume')} />
                      )}
                      {(m.status === 'active' || m.status === 'paused' || m.status === 'pending') && (
                        <ActionBtn label="Cancel" onClick={() => handleMissionAction(m.id, 'cancel')} danger />
                      )}
                      {m.status === 'failed' && (
                        <ActionBtn label="Retry" onClick={() => handleMissionAction(m.id, 'retry')} />
                      )}
                    </div>
                  </div>
                  {m.error && <p className="text-[10px] text-red-400/70 mt-1">{typeof m.error === 'string' ? m.error : ((m.error as { message?: string }).message ?? JSON.stringify(m.error))}</p>}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ActionBtn({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
        danger ? 'text-red-400 hover:bg-red-400/10' : 'text-zinc-400 hover:bg-zinc-800'
      }`}
    >
      {label}
    </button>
  );
}
