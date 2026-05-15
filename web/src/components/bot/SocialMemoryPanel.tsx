'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type EmotionalState, type SocialMemoryEntry } from '@/lib/api';

interface Props {
  botName: string;
}

const MOOD_STYLES: Record<EmotionalState['mood'], { label: string; bg: string; ring: string; text: string }> = {
  happy: { label: 'Happy', bg: 'bg-emerald-500/15', ring: 'ring-emerald-500/30', text: 'text-emerald-300' },
  neutral: { label: 'Neutral', bg: 'bg-zinc-700/40', ring: 'ring-zinc-600/40', text: 'text-zinc-300' },
  sad: { label: 'Sad', bg: 'bg-sky-500/15', ring: 'ring-sky-500/30', text: 'text-sky-300' },
  angry: { label: 'Angry', bg: 'bg-rose-500/15', ring: 'ring-rose-500/30', text: 'text-rose-300' },
  fearful: { label: 'Fearful', bg: 'bg-violet-500/15', ring: 'ring-violet-500/30', text: 'text-violet-300' },
};

const MEMORY_TYPE_LABEL: Record<SocialMemoryEntry['type'], string> = {
  chat: 'Chat',
  task_complete: 'Task complete',
  task_failure: 'Task failed',
  combat: 'Combat',
  gift: 'Gift',
  trade: 'Trade',
  observation: 'Observation',
};

function formatTimestamp(ts: number): string {
  if (!ts) return '';
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(ts).toLocaleString();
}

function valenceColor(v: number): string {
  if (v > 0.25) return 'text-emerald-400';
  if (v < -0.25) return 'text-rose-400';
  return 'text-zinc-400';
}

function valenceLabel(v: number): string {
  const arrow = v > 0.25 ? '+' : v < -0.25 ? '-' : '~';
  return `${arrow}${v.toFixed(2)}`;
}

export function SocialMemoryPanel({ botName }: Props) {
  const [memories, setMemories] = useState<SocialMemoryEntry[]>([]);
  const [emotionalState, setEmotionalState] = useState<EmotionalState | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.getBotMemories(botName);
      setMemories(data.memories ?? []);
      setEmotionalState(data.emotionalState ?? null);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [botName]);

  useEffect(() => {
    setLoading(true);
    void load();
    const interval = setInterval(() => void load(), 15_000);
    return () => clearInterval(interval);
  }, [load]);

  const mood = emotionalState?.mood ?? 'neutral';
  const moodStyle = MOOD_STYLES[mood] ?? MOOD_STYLES.neutral;
  const intensity = Math.max(0, Math.min(1, emotionalState?.intensity ?? 0));

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800/60 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">Social memory</h3>
        {emotionalState ? (
          <div
            className={`flex items-center gap-2 px-2.5 py-1 rounded-full ring-1 ${moodStyle.bg} ${moodStyle.ring}`}
          >
            <span className={`text-[11px] font-semibold ${moodStyle.text}`}>{moodStyle.label}</span>
            <span className={`text-[10px] ${moodStyle.text} opacity-80`}>
              {Math.round(intensity * 100)}%
            </span>
          </div>
        ) : (
          <span className="text-[10px] text-zinc-500">No emotional state</span>
        )}
      </div>

      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="px-4 py-6 text-center text-xs text-zinc-500">Loading…</div>
        ) : memories.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-zinc-500">No social memory recorded.</div>
        ) : (
          <ul className="divide-y divide-zinc-800/60">
            {memories.map((mem) => (
              <li key={mem.id} className="px-4 py-3 hover:bg-zinc-800/30">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400 bg-zinc-800/60 px-1.5 py-0.5 rounded">
                      {MEMORY_TYPE_LABEL[mem.type] ?? mem.type}
                    </span>
                    <span className="text-sm text-zinc-200 truncate">{mem.subject}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-mono ${valenceColor(mem.emotionalValence)}`}>
                      {valenceLabel(mem.emotionalValence)}
                    </span>
                    <span className="text-[10px] text-zinc-500">{formatTimestamp(mem.timestamp)}</span>
                  </div>
                </div>
                {mem.description ? (
                  <p className="text-xs text-zinc-400 mt-1 break-words">{mem.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
