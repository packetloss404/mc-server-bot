'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { PageHeader } from '@/components/PageHeader';
import { MissionComposer } from '@/components/MissionComposer';
import { useBotStore } from '@/lib/store';
import { api, BotEvent } from '@/lib/api';

export default function CommanderPage() {
  const bots = useBotStore((s) => s.botList);
  const [recentEvents, setRecentEvents] = useState<BotEvent[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadRecentEvents = useCallback(async () => {
    try {
      const { events } = await api.getActivity(20, undefined, 'bot:task');
      setRecentEvents(events);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    loadRecentEvents();
  }, [loadRecentEvents, refreshKey]);

  const handleMissionCreated = () => {
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
      <PageHeader title="Commander" subtitle="Create and dispatch missions using templates">
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>{bots.length} bot{bots.length !== 1 ? 's' : ''} available</span>
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main: Mission Composer */}
        <div className="lg:col-span-2">
          <MissionComposer onMissionCreated={handleMissionCreated} />
        </div>

        {/* Sidebar: Recent missions */}
        <div className="space-y-4">
          {/* Bot Quick Status */}
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Fleet Status</h3>
            {bots.length === 0 ? (
              <p className="text-xs text-zinc-600">No bots online</p>
            ) : (
              <div className="space-y-1.5">
                {bots.map((bot) => (
                  <div key={bot.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          bot.state === 'IDLE' ? 'bg-emerald-400' :
                          bot.state === 'DISCONNECTED' ? 'bg-zinc-600' :
                          'bg-amber-400'
                        }`}
                      />
                      <span className="text-xs text-zinc-300">{bot.name}</span>
                    </div>
                    <span className="text-[10px] text-zinc-600 uppercase">{bot.state}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Mission Activity */}
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Recent Missions</h3>
            {recentEvents.length === 0 ? (
              <p className="text-xs text-zinc-600">No recent mission activity</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {recentEvents.map((event, i) => (
                  <motion.div
                    key={`${event.timestamp}-${i}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="text-[11px] border-l-2 border-zinc-800 pl-2.5 py-1"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-zinc-400 font-medium">{event.botName}</span>
                      {event.metadata?.source === 'template' && (
                        <span className="text-[9px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded">
                          template
                        </span>
                      )}
                    </div>
                    <p className="text-zinc-500 mt-0.5 line-clamp-2">{event.description}</p>
                    <span className="text-[9px] text-zinc-700">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
