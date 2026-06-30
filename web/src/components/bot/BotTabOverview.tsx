'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, type BotDetailed, type BotStatsData } from '@/lib/api';
import { getPersonalityColor } from '@/lib/constants';
import { BotActivityPanel } from '@/components/BotActivityPanel';
import { BotCommandCenter } from '@/components/BotCommandCenter';
import { CommandHistoryPanel } from '@/components/CommandHistoryPanel';
import { StatsPanel } from '@/components/StatsPanel';
import { WorldContext } from '@/components/WorldContext';

interface Props {
  botName: string;
  personality: string;
}

interface LlmRouting {
  defaultProvider: string;
  providers: { name: string; model: string; enabled: boolean }[];
  routes: Record<string, { provider?: string; model?: string }>;
}

const DEFAULT_STATS: BotStatsData = {
  mined: {},
  crafted: {},
  smelted: {},
  placed: {},
  killed: {},
  withdrew: {},
  deposited: {},
  deaths: 0,
  interrupts: 0,
  movementTimeouts: 0,
  damageTaken: 0,
};

export function BotTabOverview({ botName, personality }: Props) {
  const [bot, setBot] = useState<BotDetailed | null>(null);
  const [llmRouting, setLlmRouting] = useState<LlmRouting | null>(null);

  const accentColor = getPersonalityColor(personality);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .getBotDetailed(botName)
        .then((data) => {
          if (!cancelled) setBot(data.bot);
        })
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [botName]);

  useEffect(() => {
    let cancelled = false;
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const loadLlm = () => {
      fetch(`${base}/api/llm/providers`, { credentials: 'include' })
        .then((r) => r.json())
        .then((s) => {
          if (cancelled) return;
          setLlmRouting({
            defaultProvider: s.defaultProvider,
            providers: (s.providers ?? []).map(
              (p: { name: string; model: string; enabled: boolean }) => ({
                name: p.name,
                model: p.model,
                enabled: p.enabled,
              }),
            ),
            routes: s.routes ?? {},
          });
        })
        .catch(() => {});
    };
    loadLlm();
    const interval = setInterval(loadLlm, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const resolveRoute = (
    taskType: 'codegen' | 'chat' | 'curriculum' | 'critic',
  ): { provider: string; model: string } | null => {
    if (!llmRouting) return null;
    const route = llmRouting.routes[taskType];
    const provider = route?.provider || llmRouting.defaultProvider;
    const providerCfg = llmRouting.providers.find((p) => p.name === provider);
    return { provider, model: route?.model || providerCfg?.model || 'default' };
  };

  if (!bot) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-center">
          <div className="w-7 h-7 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs text-zinc-500">Loading overview...</p>
        </div>
      </div>
    );
  }

  const aiRoute = resolveRoute(bot.mode === 'codegen' ? 'codegen' : 'chat');

  return (
    <div className="space-y-5">
      {/* AI routing header */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4"
      >
        {aiRoute ? (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-600">AI:</span>
            <span className="font-mono font-medium" style={{ color: '#A855F7' }}>
              {aiRoute.provider}/{aiRoute.model}
            </span>
          </div>
        ) : (
          <div className="text-xs text-zinc-600">AI routing unavailable</div>
        )}
      </motion.div>

      {/* 2-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* LEFT COLUMN (3/5) */}
        <div className="lg:col-span-3 space-y-5">
          <BotActivityPanel
            state={bot.state}
            voyager={bot.voyager}
            combat={bot.combat}
            health={bot.health}
            accentColor={accentColor}
          />

          <BotCommandCenter
            botName={bot.name}
            state={bot.state}
            voyagerPaused={bot.voyager?.isPaused}
            voyagerRunning={bot.voyager?.isRunning}
            mode={bot.mode}
          />

          <CommandHistoryPanel botName={bot.name} />
        </div>

        {/* RIGHT COLUMN (2/5) */}
        <div className="lg:col-span-2 space-y-5">
          <StatsPanel stats={bot.stats ?? DEFAULT_STATS} />

          {bot.world && (
            <WorldContext
              nearbyEntities={bot.world.nearbyEntities}
              nearbyBlocks={bot.world.nearbyBlocks}
              biome={bot.world.biome}
              timeOfDay={bot.world.timeOfDay}
              isRaining={bot.world.isRaining}
            />
          )}
        </div>
      </div>
    </div>
  );
}
