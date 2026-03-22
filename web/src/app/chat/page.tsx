'use client';

import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useBotStore } from '@/lib/store';
import { api, type ChatMessage } from '@/lib/api';
import { getPersonalityColor } from '@/lib/constants';

interface Thread {
  botName: string;
  playerName: string;
  messages: ChatMessage[];
  lastActivity: number;
}

export default function ChatPage() {
  const bots = useBotStore((s) => s.botList);
  const resetUnread = useBotStore((s) => s.resetUnreadChats);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selected, setSelected] = useState<{ bot: string; player: string } | null>(null);
  const [adminMsg, setAdminMsg] = useState('');
  const [adminPlayer, setAdminPlayer] = useState('');
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    resetUnread();
    return () => {};
  }, [resetUnread]);

  useEffect(() => {
    const loadAll = async () => {
      const allThreads: Thread[] = [];
      for (const bot of bots) {
        try {
          const data = await api.getBotConversations(bot.name);
          for (const [player, messages] of Object.entries(data.conversations)) {
            const lastMsg = messages[messages.length - 1];
            allThreads.push({
              botName: bot.name,
              playerName: player,
              messages,
              lastActivity: lastMsg?.timestamp ?? 0,
            });
          }
        } catch { /* ignore */ }
      }
      // Sort by most recent activity
      allThreads.sort((a, b) => b.lastActivity - a.lastActivity);
      setThreads(allThreads);
    };
    loadAll();
    const interval = setInterval(loadAll, 5000);
    return () => clearInterval(interval);
  }, [bots.length]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selected, threads]);

  const selectedThread = selected
    ? threads.find((t) => t.botName === selected.bot && t.playerName === selected.player)
    : null;

  const handleSend = async () => {
    if (!selected || !adminMsg.trim() || sending) return;
    const playerName = adminPlayer.trim() || 'admin';
    setSending(true);
    try {
      await api.sendChat(selected.bot, playerName, adminMsg.trim());
      setAdminMsg('');
    } catch { /* ignore */ }
    setSending(false);
  };

  const filteredThreads = search
    ? threads.filter(
        (t) =>
          t.botName.toLowerCase().includes(search.toLowerCase()) ||
          t.playerName.toLowerCase().includes(search.toLowerCase()),
      )
    : threads;

  return (
    <div className="flex h-screen">
      {/* Sidebar: thread list */}
      <div className="w-72 border-r border-zinc-800/60 overflow-hidden flex flex-col bg-zinc-950/50 shrink-0">
        <div className="p-4 border-b border-zinc-800/60">
          <h2 className="text-sm font-bold text-white mb-3">Conversations</h2>
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500"
              width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations..."
              className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-zinc-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredThreads.length === 0 ? (
            <p className="px-4 py-8 text-xs text-zinc-600 text-center">
              {search ? 'No matching conversations' : 'No conversations yet'}
            </p>
          ) : (
            filteredThreads.map((thread) => {
              const isActive = selected?.bot === thread.botName && selected?.player === thread.playerName;
              const bot = bots.find((b) => b.name === thread.botName);
              const color = bot ? getPersonalityColor(bot.personality) : '#6B7280';
              const lastMsg = thread.messages[thread.messages.length - 1];
              return (
                <button
                  key={`${thread.botName}-${thread.playerName}`}
                  onClick={() => setSelected({ bot: thread.botName, player: thread.playerName })}
                  className={`w-full text-left px-4 py-3 border-b border-zinc-800/30 transition-all ${
                    isActive ? 'bg-zinc-800/80' : 'hover:bg-zinc-800/40'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs font-medium text-white truncate">{thread.botName}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                    <span className="text-xs text-zinc-400 truncate">{thread.playerName}</span>
                  </div>
                  {lastMsg && (
                    <p className="text-[11px] text-zinc-600 truncate pl-4">
                      {lastMsg.role === 'model' ? thread.botName : thread.playerName}: {lastMsg.text}
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-1 pl-4">
                    <span className="text-[10px] text-zinc-700">{thread.messages.length} messages</span>
                    {thread.lastActivity > 0 && (
                      <span className="text-[10px] text-zinc-700">
                        {new Date(thread.lastActivity).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col bg-zinc-950/30">
        {selectedThread ? (
          <>
            {/* Chat header */}
            <div className="px-5 py-3 border-b border-zinc-800/60 flex items-center justify-between bg-zinc-950/50">
              <div className="flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: `${getPersonalityColor(bots.find((b) => b.name === selectedThread.botName)?.personality ?? '')}20` }}
                >
                  <img
                    src={`https://mc-heads.net/avatar/${selectedThread.botName}/20`}
                    alt=""
                    className="w-5 h-5 rounded pixelated"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{selectedThread.botName}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="2.5">
                      <path d="M5 12h14M12 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm text-zinc-400">{selectedThread.playerName}</span>
                  </div>
                  <p className="text-[10px] text-zinc-600">{selectedThread.messages.length} messages</p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              <AnimatePresence>
                {selectedThread.messages.map((msg, i) => {
                  const isBot = msg.role === 'model';
                  const bot = bots.find((b) => b.name === selectedThread.botName);
                  const color = bot ? getPersonalityColor(bot.personality) : '#6B7280';
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`flex ${isBot ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className="max-w-[65%]">
                        <p className={`text-[10px] text-zinc-600 mb-0.5 ${isBot ? 'text-right' : ''}`}>
                          {isBot ? selectedThread.botName : selectedThread.playerName}
                          {msg.timestamp && (
                            <span className="ml-2 text-zinc-700">
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </p>
                        <div
                          className={`px-3.5 py-2 rounded-2xl text-[13px] leading-relaxed ${
                            isBot
                              ? 'rounded-br-md'
                              : 'rounded-bl-md'
                          }`}
                          style={{
                            backgroundColor: isBot ? `${color}18` : '#1c1c1e',
                            color: isBot ? color : '#d4d4d8',
                            borderLeft: isBot ? 'none' : `2px solid #27272a`,
                            borderRight: isBot ? `2px solid ${color}40` : 'none',
                          }}
                        >
                          {msg.text}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              <div ref={messagesEndRef} />
            </div>

            {/* Send message */}
            <div className="border-t border-zinc-800/60 px-5 py-3 bg-zinc-950/50">
              <div className="flex gap-2">
                <div className="relative shrink-0">
                  <input
                    value={adminPlayer}
                    onChange={(e) => setAdminPlayer(e.target.value)}
                    placeholder="As player..."
                    className="bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-600 w-32"
                  />
                </div>
                <div className="flex-1 relative">
                  <input
                    value={adminMsg}
                    onChange={(e) => setAdminMsg(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                    placeholder="Type a message..."
                    className="w-full bg-zinc-800/80 border border-zinc-700/50 rounded-lg px-4 py-2 text-xs text-white placeholder-zinc-600"
                    disabled={sending}
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={sending || !adminMsg.trim()}
                  className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded-lg text-xs font-medium transition-colors"
                >
                  {sending ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Sending
                    </span>
                  ) : (
                    'Send'
                  )}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-14 h-14 rounded-full bg-zinc-800/50 flex items-center justify-center mx-auto mb-4">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#4B5563" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="text-sm text-zinc-500">Select a conversation</p>
              <p className="text-xs text-zinc-600 mt-1">{threads.length} conversation{threads.length !== 1 ? 's' : ''} available</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
