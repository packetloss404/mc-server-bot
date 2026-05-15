'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { api, type ChatMessage } from '@/lib/api';
import { getPersonalityColor } from '@/lib/constants';

interface Props {
  botName: string;
  personality: string;
}

export function BotTabConsole({ botName, personality }: Props) {
  const [conversations, setConversations] = useState<Record<string, ChatMessage[]>>({});
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [chatMsg, setChatMsg] = useState('');
  const [chatPlayer, setChatPlayer] = useState('');

  const accentColor = getPersonalityColor(personality);

  // Conversations are NOT in /detailed, so we still fetch them here — but at a
  // slower cadence (10s) since the BotPollingProvider already runs a 3s tick
  // for everything in /detailed.
  useEffect(() => {
    const load = () => {
      api
        .getBotConversations(botName)
        .then((data) => setConversations(data.conversations))
        .catch(() => {});
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [botName]);

  const handleSendChat = async () => {
    if (!chatMsg.trim()) return;
    const player = chatPlayer.trim() || 'admin';
    try {
      await api.sendChat(botName, player, chatMsg.trim());
      setChatMsg('');
    } catch {
      /* ignore */
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4"
    >
      <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Console</h2>

      {selectedPlayer && conversations[selectedPlayer] ? (
        <div className="space-y-2">
          <button
            onClick={() => setSelectedPlayer(null)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>{' '}
            Back
          </button>
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/40">
            <img
              src={`https://mc-heads.net/avatar/${selectedPlayer}/20`}
              alt=""
              className="w-5 h-5 rounded pixelated"
              style={{ imageRendering: 'pixelated' }}
            />
            <span className="text-xs text-zinc-300 font-medium">{selectedPlayer}</span>
          </div>
          <div className="max-h-96 overflow-y-auto space-y-2">
            {conversations[selectedPlayer].map((msg, i) => (
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
          </div>
          <div className="flex gap-2 pt-2 border-t border-zinc-800/40">
            <input
              value={chatMsg}
              onChange={(e) => setChatMsg(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
              placeholder={`Reply as ${chatPlayer || 'admin'}...`}
              className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
            />
            <button
              onClick={handleSendChat}
              disabled={!chatMsg.trim()}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white px-2.5 py-1.5 rounded-lg text-xs transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {Object.keys(conversations).length === 0 ? (
            <p className="text-xs text-zinc-600 text-center py-3">No conversations yet</p>
          ) : (
            Object.entries(conversations).map(([player, msgs]) => (
              <button
                key={player}
                onClick={() => {
                  setSelectedPlayer(player);
                  setChatPlayer(player);
                }}
                className="w-full text-left flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-zinc-800/40 transition-colors"
              >
                <img
                  src={`https://mc-heads.net/avatar/${player}/20`}
                  alt=""
                  className="w-5 h-5 rounded pixelated shrink-0"
                  style={{ imageRendering: 'pixelated' }}
                />
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-zinc-300 font-medium">{player}</span>
                  {msgs[msgs.length - 1] && (
                    <p className="text-[10px] text-zinc-600 truncate">{msgs[msgs.length - 1].text}</p>
                  )}
                </div>
                <span className="text-[10px] text-zinc-600 shrink-0">{msgs.length}</span>
              </button>
            ))
          )}
          <div className="pt-3 border-t border-zinc-800/40 mt-3 space-y-2">
            <input
              value={chatPlayer}
              onChange={(e) => setChatPlayer(e.target.value)}
              placeholder="As player..."
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
            />
            <div className="flex gap-2">
              <input
                value={chatMsg}
                onChange={(e) => setChatMsg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                placeholder="Send a message..."
                className="flex-1 bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-white placeholder-zinc-600"
              />
              <button
                onClick={handleSendChat}
                disabled={!chatMsg.trim()}
                className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white px-3 py-1.5 rounded-lg text-xs transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
