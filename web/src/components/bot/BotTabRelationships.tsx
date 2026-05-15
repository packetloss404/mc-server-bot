'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, type ChatMessage } from '@/lib/api';
import { getAffinityTier, getPersonalityColor } from '@/lib/constants';

interface Props {
  botName: string;
  personality: string;
}

export function BotTabRelationships({ botName, personality }: Props) {
  const [relationships, setRelationships] = useState<Record<string, number>>({});
  const [conversations, setConversations] = useState<Record<string, ChatMessage[]>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);

  const accentColor = getPersonalityColor(personality);

  useEffect(() => {
    const load = () => {
      api
        .getBotRelationships(botName)
        .then((data) => setRelationships(data.relationships))
        .catch(() => {});
      api
        .getBotConversations(botName)
        .then((data) => setConversations(data.conversations))
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [botName]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
    >
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
        Relationships ({Object.keys(relationships).length})
      </h2>

      {Object.keys(relationships).length === 0 ? (
        <p className="text-xs text-zinc-600 text-center py-3">No relationships yet</p>
      ) : (
        <div className="space-y-2.5">
          {Object.entries(relationships)
            .sort(([, a], [, b]) => b - a)
            .map(([player, score]) => {
              const tier = getAffinityTier(score);
              const isOpen = selectedPlayer === player;
              const convo = conversations[player];
              return (
                <div key={player} className="rounded-lg overflow-hidden">
                  <button
                    onClick={() => setSelectedPlayer(isOpen ? null : player)}
                    className={`w-full text-left p-2 transition-colors ${
                      isOpen ? 'bg-zinc-800/60' : 'hover:bg-zinc-800/30'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <img
                        src={`https://mc-heads.net/avatar/${player}/20`}
                        alt=""
                        className="w-5 h-5 rounded pixelated shrink-0"
                        style={{ imageRendering: 'pixelated' }}
                      />
                      <span className="text-xs text-zinc-300 flex-1 truncate">{player}</span>
                      <span style={{ color: tier.color }} className="text-[10px] font-medium">
                        {tier.label} ({score})
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-zinc-800 rounded-full mt-1.5 overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ backgroundColor: tier.color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(0, Math.min(100, score))}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                  </button>

                  {isOpen && convo && convo.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="p-2 bg-zinc-900/60 space-y-1 max-h-72 overflow-y-auto"
                    >
                      {convo.slice(-20).map((msg, i) => (
                        <div
                          key={i}
                          className={`text-xs px-3 py-1.5 rounded-xl max-w-[85%] ${
                            msg.role === 'model' ? 'ml-auto rounded-br-sm' : 'mr-auto rounded-bl-sm'
                          }`}
                          style={{
                            backgroundColor: msg.role === 'model' ? `${accentColor}15` : '#1c1c1e',
                            color: msg.role === 'model' ? accentColor : '#a1a1aa',
                          }}
                        >
                          {msg.text}
                        </div>
                      ))}
                    </motion.div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </motion.div>
  );
}
