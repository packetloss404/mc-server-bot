'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api } from '@/lib/api';
import { getPersonalityColor, getAffinityTier, PERSONALITY_ICONS } from '@/lib/constants';
import { useBotStore } from '@/lib/store';
import { PageHeader } from '@/components/PageHeader';
import { SkeletonCardGrid } from '@/components/SkeletonLoader';

type ViewMode = 'cards' | 'matrix';

export default function SocialPage() {
  const bots = useBotStore((s) => s.botList);
  const [relationships, setRelationships] = useState<Record<string, Record<string, number>>>({});
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getRelationships()
      .then((data) => setRelationships(data.relationships))
      .catch(() => {})
      .finally(() => setLoading(false));
    const interval = setInterval(() => {
      api.getRelationships().then((data) => setRelationships(data.relationships)).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const allPlayers = new Set<string>();
  for (const players of Object.values(relationships)) {
    for (const player of Object.keys(players)) {
      allPlayers.add(player);
    }
  }

  const hasData = Object.keys(relationships).length > 0;

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
      <PageHeader title="Social Graph" subtitle={`${Object.keys(relationships).length} bots \u00B7 ${allPlayers.size} players`}>
        {hasData && (
          <div className="flex bg-zinc-800/50 rounded-lg p-0.5 border border-zinc-700/30">
            <button
              onClick={() => setViewMode('cards')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'cards' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Cards
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                viewMode === 'matrix' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Matrix
            </button>
          </div>
        )}
      </PageHeader>

      {loading ? (
        <SkeletonCardGrid count={4} />
      ) : !hasData ? (
        <div className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40">
          <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <p className="text-sm text-zinc-500">No relationship data yet</p>
          <p className="text-xs text-zinc-600 mt-1">Bots build relationships through interactions with players</p>
        </div>
      ) : viewMode === 'matrix' ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 overflow-x-auto"
        >
          <table className="text-xs w-full">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left text-zinc-500 font-medium sticky left-0 bg-zinc-900/95 backdrop-blur-sm">
                  Bot / Player
                </th>
                {Array.from(allPlayers).map((player) => (
                  <th key={player} className="px-3 py-3 text-zinc-400 font-medium text-center min-w-[100px]">
                    <div className="flex items-center justify-center gap-1.5">
                      <img
                        src={`https://mc-heads.net/avatar/${player}/16`}
                        alt=""
                        className="w-4 h-4 rounded pixelated"
                        style={{ imageRendering: 'pixelated' }}
                      />
                      {player}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(relationships).map(([botName, players]) => {
                const botInfo = bots.find((b) => b.name.toLowerCase() === botName.toLowerCase());
                const accentColor = botInfo ? getPersonalityColor(botInfo.personality) : '#6B7280';
                return (
                  <tr key={botName} className="border-t border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium sticky left-0 bg-zinc-900/95 backdrop-blur-sm" style={{ color: accentColor }}>
                      <div className="flex items-center gap-2">
                        <span>{PERSONALITY_ICONS[botInfo?.personality?.toLowerCase() ?? ''] ?? ''}</span>
                        {botName}
                      </div>
                    </td>
                    {Array.from(allPlayers).map((player) => {
                      const score = players[player];
                      if (score === undefined) return <td key={player} className="px-3 py-2.5 text-center text-zinc-800">-</td>;
                      const tier = getAffinityTier(score);
                      return (
                        <td key={player} className="px-3 py-2.5 text-center">
                          <span
                            className="inline-block px-2.5 py-1 rounded-md text-[10px] font-medium"
                            style={{ color: tier.color, backgroundColor: `${tier.color}12` }}
                          >
                            {score} {tier.label}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Object.entries(relationships).map(([botName, players], i) => {
            const botInfo = bots.find((b) => b.name.toLowerCase() === botName.toLowerCase());
            const accentColor = botInfo ? getPersonalityColor(botInfo.personality) : '#6B7280';
            const emoji = PERSONALITY_ICONS[botInfo?.personality?.toLowerCase() ?? ''] ?? '';
            return (
              <motion.div
                key={botName}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
              >
                <div
                  className="h-0.5"
                  style={{ background: `linear-gradient(90deg, ${accentColor}, ${accentColor}60)` }}
                />
                <div className="p-4">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-sm"
                      style={{ backgroundColor: `${accentColor}15` }}
                    >
                      {emoji}
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold" style={{ color: accentColor }}>{botName}</h3>
                      <p className="text-[10px] text-zinc-600">{Object.keys(players).length} relationships</p>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    {Object.entries(players).sort(([, a], [, b]) => b - a).map(([player, score]) => {
                      const tier = getAffinityTier(score);
                      return (
                        <div key={player} className="group">
                          <div className="flex items-center gap-2.5">
                            <img
                              src={`https://mc-heads.net/avatar/${player}/20`}
                              alt=""
                              className="w-5 h-5 rounded pixelated shrink-0"
                              style={{ imageRendering: 'pixelated' }}
                            />
                            <span className="text-xs text-zinc-300 w-24 truncate">{player}</span>
                            <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                              <motion.div
                                className="h-full rounded-full"
                                style={{ backgroundColor: tier.color }}
                                initial={{ width: 0 }}
                                animate={{ width: `${score}%` }}
                                transition={{ duration: 0.6, delay: 0.1 }}
                              />
                            </div>
                            <span
                              className="text-[10px] font-medium w-20 text-right shrink-0"
                              style={{ color: tier.color }}
                            >
                              {tier.label} ({score})
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
