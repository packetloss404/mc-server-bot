'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useBotStore, type BotLiveData } from '@/lib/store';
import { BotCard } from '@/components/BotCard';
import { api, type SquadRecord } from '@/lib/api';

export default function FleetPage() {
  const bots = useBotStore((s) => s.botList);
  const [squads, setSquads] = useState<SquadRecord[]>([]);
  const [missionTitles, setMissionTitles] = useState<Record<string, string>>({});

  // Fetch squads on mount and periodically
  useEffect(() => {
    const fetchSquads = async () => {
      try {
        const { squads: fetched } = await api.getSquads();
        setSquads(fetched);

        // Resolve activeMissionId titles
        const titleMap: Record<string, string> = {};
        for (const squad of fetched) {
          if (squad.activeMissionId && !missionTitles[squad.activeMissionId]) {
            try {
              const mission = await api.getMission(squad.activeMissionId);
              if (mission) {
                titleMap[squad.activeMissionId] = mission.title;
              }
            } catch {
              // mission may have been deleted
            }
          }
        }
        if (Object.keys(titleMap).length > 0) {
          setMissionTitles((prev) => ({ ...prev, ...titleMap }));
        }
      } catch {
        // API not available yet
      }
    };

    fetchSquads();
    const interval = setInterval(fetchSquads, 15000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-[1400px]">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div>
          <h1 className="text-lg font-bold text-white">Fleet Management</h1>
          <p className="text-xs text-zinc-500 mt-0.5">
            Manage bots and squads across your server.
          </p>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <FleetStat label="Total Bots" value={bots.length} color="#6B7280" />
        <FleetStat
          label="Active"
          value={bots.filter((b) => !['IDLE', 'DISCONNECTED'].includes(b.state)).length}
          color="#10B981"
        />
        <FleetStat
          label="Idle"
          value={bots.filter((b) => b.state === 'IDLE').length}
          color="#F59E0B"
        />
        <FleetStat label="Squads" value={squads.length} color="#8B5CF6" />
      </div>

      {/* Squads */}
      {squads.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-purple-400 uppercase tracking-wider mb-4">
            Squads ({squads.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {squads.map((squad, i) => (
              <SquadCard
                key={squad.id}
                squad={squad}
                index={i}
                missionTitle={squad.activeMissionId ? missionTitles[squad.activeMissionId] : undefined}
                bots={bots}
              />
            ))}
          </div>
        </section>
      )}

      {/* All Bots */}
      <section>
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-4">
          All Bots ({bots.length})
        </h2>
        {bots.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {bots.map((bot, i) => (
              <BotCard key={bot.name} bot={bot} index={i} />
            ))}
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 bg-zinc-900/50 rounded-xl border border-zinc-800/40"
          >
            <p className="text-sm text-zinc-500">No bots online</p>
            <p className="text-xs text-zinc-600 mt-1">
              <Link href="/manage" className="text-emerald-500 hover:text-emerald-400">Create a bot</Link> to get started
            </p>
          </motion.div>
        )}
      </section>
    </div>
  );
}

function FleetStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
      <p className="text-[11px] text-zinc-500 font-medium uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
    </div>
  );
}

function SquadCard({
  squad,
  index,
  missionTitle,
  bots,
}: {
  squad: SquadRecord;
  index: number;
  missionTitle?: string;
  bots: BotLiveData[];
}) {
  const memberBots = bots.filter((b) =>
    squad.botNames.some((n) => n.toLowerCase() === b.name.toLowerCase())
  );
  const activeCount = memberBots.filter(
    (b) => !['IDLE', 'DISCONNECTED'].includes(b.state)
  ).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl overflow-hidden"
    >
      {/* Purple accent bar */}
      <div className="h-0.5 bg-gradient-to-r from-purple-500 to-purple-500/50" />

      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">{squad.name}</h3>
            <p className="text-[11px] text-zinc-500">
              {squad.botNames.length} member{squad.botNames.length !== 1 ? 's' : ''}
              {activeCount > 0 && (
                <span className="text-emerald-400 ml-1">({activeCount} active)</span>
              )}
            </p>
          </div>
          {squad.defaultRole && (
            <span className="text-[10px] font-medium px-2 py-1 rounded-md bg-zinc-800/80 text-zinc-400 uppercase tracking-wide shrink-0">
              {squad.defaultRole}
            </span>
          )}
        </div>

        {/* Active Mission */}
        {squad.activeMissionId && (
          <div className="flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 rounded-lg px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] text-purple-300/70 uppercase tracking-wider font-medium">Active Mission</p>
              <p className="text-xs text-purple-200 truncate">
                {missionTitle || squad.activeMissionId}
              </p>
            </div>
          </div>
        )}

        {/* Member list */}
        {squad.botNames.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {squad.botNames.map((name) => {
              const bot = bots.find((b) => b.name.toLowerCase() === name.toLowerCase());
              const isOnline = bot && bot.state !== 'DISCONNECTED';
              return (
                <span
                  key={name}
                  className="text-[10px] px-1.5 py-0.5 rounded border"
                  style={{
                    color: isOnline ? '#d4d4d8' : '#71717a',
                    backgroundColor: isOnline ? '#27272a' : '#18181b',
                    borderColor: isOnline ? '#3f3f46' : '#27272a',
                  }}
                >
                  {isOnline && (
                    <span className="inline-block w-1 h-1 rounded-full bg-emerald-400 mr-1 align-middle" />
                  )}
                  {name}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
