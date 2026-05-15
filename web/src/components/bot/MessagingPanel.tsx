'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type BotMessage } from '@/lib/api';

interface Props {
  botName: string;
}

const TYPE_COLORS: Record<BotMessage['type'], string> = {
  chat: 'text-zinc-300 bg-zinc-800/60',
  help_request: 'text-amber-300 bg-amber-500/10',
  trade_offer: 'text-emerald-300 bg-emerald-500/10',
  alert: 'text-rose-300 bg-rose-500/10',
  status: 'text-sky-300 bg-sky-500/10',
};

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

export function MessagingPanel({ botName }: Props) {
  const [messages, setMessages] = useState<BotMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setRefreshing(true);
      try {
        const data = await api.getBotMessages(botName);
        setMessages(data.messages ?? []);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [botName],
  );

  useEffect(() => {
    setLoading(true);
    void load();
    const interval = setInterval(() => void load(), 10_000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Messages</h3>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {messages.length} unread message{messages.length === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="text-[11px] px-2.5 py-1 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 disabled:opacity-50 transition-colors"
        >
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-zinc-500">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-500">No messages.</div>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {messages.map((msg) => (
              <li key={msg.id} className="px-4 py-3 hover:bg-zinc-800/30">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-white truncate">{msg.from}</span>
                    <span
                      className={`text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded ${TYPE_COLORS[msg.type] ?? 'text-zinc-400 bg-zinc-800/60'}`}
                    >
                      {msg.type.replace('_', ' ')}
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-500 shrink-0">{formatTimestamp(msg.timestamp)}</span>
                </div>
                <p className="text-xs text-zinc-300 mt-1.5 break-words">{msg.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
