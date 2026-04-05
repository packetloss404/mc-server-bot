'use client';

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { useBotStore } from '@/lib/store';
import { api, type BotEvent } from '@/lib/api';
import { BotCard } from '@/components/BotCard';
import { EVENT_CONFIG } from '@/lib/constants';
import Link from 'next/link';

export default function DashboardPage() {
  const bots = useBotStore((s) => s.botList);
  const players = useBotStore((s) => s.playerList);
  const activityFeed = useBotStore((s) => s.activityFeed);
  const connected = useBotStore((s) => s.connected);
  const world = useBotStore((s) => s.world);

  useEffect(() => {
    if (useBotStore.getState().activityFeed.length > 0) return;
    api.getActivity(20).then((data) => {
      for (const event of data.events.reverse()) {
        useBotStore.getState().pushEvent(event);
      }
    }).catch(() => {});
  }, []);

  const botNames = new Set(bots.map((b) => b.name.toLowerCase()));
  const onlinePlayers = players.filter((p) => p.isOnline && !botNames.has(p.name.toLowerCase()));
  const activeBots = bots.filter((b) => b.state !== 'IDLE' && b.state !== 'DISCONNECTED');

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-[1400px]">
      {/* Hero Stats Row */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3"
      >
        <StatCard
          label="Bots Online"
          value={bots.length}
          subtext={`${activeBots.length} active`}
          color="#10B981"
        />
        <StatCard
          label="Players Online"
          value={onlinePlayers.length}
          subtext={onlinePlayers.map((p) => p.name).join(', ') || 'None'}
          color="#60A5FA"
        />
        <StatCard
          label="World Time"
          value={world?.timeOfDay ?? '---'}
          subtext={world ? `Day ${world.day ?? '?'}` : '---'}
          color="#F59E0B"
          isText
        />
        <StatCard
          label="Weather"
          value={world?.isRaining ? 'Raining' : 'Clear'}
          subtext={connected ? 'Live data' : 'Disconnected'}
          color={world?.isRaining ? '#60A5FA' : '#10B981'}
          isText
        />
      </motion.div>

      {/* Quick Actions */}
      <div className="flex items-center gap-3">
        <Link
          href="/map"
          className="text-xs bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors border border-zinc-700/50"
        >
          Open Map
        </Link>
        <Link
          href="/manage"
          className="text-xs bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors border border-zinc-700/50"
        >
          Create Bot
        </Link>
        <Link
          href="/chat"
          className="text-xs bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors border border-zinc-700/50"
        >
          Open Chat
        </Link>
      </div>

      {/* Bot Grid */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Bots ({bots.length})
          </h2>
          <Link href="/manage" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
            Manage All
          </Link>
        </div>

        {bots.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40"
          >
            <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mx-auto mb-3">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
              </svg>
            </div>
            <p className="text-sm text-zinc-500">No bots online</p>
            <p className="text-xs text-zinc-600 mt-1">
              <Link href="/manage" className="text-emerald-500 hover:text-emerald-400">Create a bot</Link> to get started
            </p>
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {bots.map((bot, i) => (
              <BotCard key={bot.name} bot={bot} index={i} />
            ))}
          </div>
        )}
      </section>

      {/* Online Players */}
      {onlinePlayers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-4">
            Online Players ({onlinePlayers.length})
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {onlinePlayers.map((player, i) => (
              <motion.div
                key={player.name}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
                className="bg-zinc-900/80 border border-zinc-800/60 rounded-lg p-3 flex items-center gap-2.5"
              >
                <img
                  src={`https://mc-heads.net/avatar/${player.name}/24`}
                  alt={player.name}
                  className="w-6 h-6 rounded pixelated"
                  style={{ imageRendering: 'pixelated' }}
                />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-white truncate">{player.name}</p>
                  {player.position && (
                    <p className="text-[10px] text-zinc-500 font-mono tabular-nums">
                      {Math.round(player.position.x)}, {Math.round(player.position.z)}
                    </p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Activity Feed */}
      {activityFeed.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Recent Activity
            </h2>
            <Link href="/activity" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              View All
            </Link>
          </div>
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800/40 divide-y divide-zinc-800/40">
            {activityFeed.slice(0, 15).map((event, i) => (
              <ActivityEntry key={`${event.timestamp}-${i}`} event={event} index={i} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({
  label, value, subtext, color, isText = false,
}: {
  label: string; value: string | number; subtext: string; color: string; isText?: boolean;
}) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
      <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">{label}</p>
      <p
        className={`${isText ? 'text-lg' : 'text-2xl'} font-bold mt-1 capitalize`}
        style={{ color }}
      >
        {value}
      </p>
      <p className="text-[11px] text-zinc-600 mt-0.5 truncate">{subtext}</p>
    </div>
  );
}

function ActivityEntry({ event, index }: { event: BotEvent; index: number }) {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const config = EVENT_CONFIG[event.type];
  const color = config?.color ?? '#6B7280';

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      className="flex items-center gap-3 px-4 py-2.5 text-xs"
    >
      <span className="text-zinc-600 font-mono shrink-0 w-16 tabular-nums">{time}</span>
      <span
        className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0"
        style={{ color, backgroundColor: `${color}15` }}
      >
        {config?.icon ?? '.'}
      </span>
      <span className="text-zinc-300 font-medium shrink-0">{event.botName}</span>
      <span className="text-zinc-500 truncate flex-1">{event.description}</span>
    </motion.div>
  );
}
