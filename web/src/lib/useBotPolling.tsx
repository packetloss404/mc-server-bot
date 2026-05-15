'use client';

/**
 * Shared per-bot polling context.
 *
 * Before: every bot tab (Console, Tasks, Inventory, Relationships, Overview)
 * ran its own setInterval polling `/api/bots/:name/detailed`. With five tabs
 * mounted that meant five overlapping requests every few seconds for the same
 * payload.
 *
 * Now: <BotPollingProvider botName={name}/> wraps the bot detail page and runs
 * a single interval. Tabs call useBotPolling() to read the shared snapshot.
 *
 * Tabs whose data is NOT covered by /detailed (relationships, conversations,
 * task history) keep their own fetch but use a slower cadence (10s) since the
 * shared 3s tick already covers vitals, position, inventory, and current task.
 */

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { api, type BotDetailed } from './api';

interface BotPollingContextValue {
  bot: BotDetailed | null;
  error: string | null;
  refresh: () => Promise<void>;
}

const BotPollingContext = createContext<BotPollingContextValue | null>(null);

interface ProviderProps {
  botName: string;
  intervalMs?: number;
  children: ReactNode;
}

export function BotPollingProvider({ botName, intervalMs = 3000, children }: ProviderProps) {
  const [bot, setBot] = useState<BotDetailed | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep latest botName in a ref so the interval closure always refreshes the
  // right bot if the provider is remounted with a different name.
  const nameRef = useRef(botName);
  nameRef.current = botName;

  const refresh = useCallback(async () => {
    try {
      const data = await api.getBotDetailed(nameRef.current);
      setBot(data.bot);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bot');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.getBotDetailed(botName);
        if (!cancelled) {
          setBot(data.bot);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load bot');
        }
      }
    };
    load();
    const interval = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [botName, intervalMs]);

  return (
    <BotPollingContext.Provider value={{ bot, error, refresh }}>
      {children}
    </BotPollingContext.Provider>
  );
}

/**
 * Read the shared bot snapshot. Returns null bot/error if used outside a
 * BotPollingProvider — components can fall back to their own fetch in that
 * case (e.g. when rendered standalone in tests or storybook).
 */
export function useBotPolling(): BotPollingContextValue {
  const ctx = useContext(BotPollingContext);
  if (!ctx) {
    return { bot: null, error: null, refresh: async () => {} };
  }
  return ctx;
}

/** True iff the calling component is inside a BotPollingProvider. */
export function useHasBotPolling(): boolean {
  return useContext(BotPollingContext) !== null;
}
