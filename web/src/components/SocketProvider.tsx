'use client';

import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { useBotStore } from '@/lib/store';
import {
  useControlStore,
  useMissionStore,
  useWorldStore,
  useFleetStore,
  useRoleStore,
  useBuildStore,
  useChainStore,
} from '@/lib/controlStores';
import { api } from '@/lib/api';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const {
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats,
  } = useBotStore();

  const { upsertCommand } = useControlStore();
  const { upsertMission } = useMissionStore();
  const { upsertMarker, upsertZone, upsertRoute } = useWorldStore();
  const { upsertSquad } = useFleetStore();
  const { upsertAssignment } = useRoleStore();
  const { upsertBuild } = useBuildStore();
  const { upsertChain } = useChainStore();

  useEffect(() => {
    // Initial fetch
    api.getBots().then((data) => setBots(data.bots)).catch(console.error);
    api.getWorld().then((data) => setWorld(data)).catch(() => {});
    api.getPlayers().then((data) => setPlayers(data.players)).catch(() => {});

    // Poll bots every 5s as a fallback
    const pollInterval = setInterval(() => {
      api.getBots().then((data) => setBots(data.bots)).catch(() => {});
    }, 5000);

    // Poll world state every 30s
    const worldInterval = setInterval(() => {
      api.getWorld().then((data) => setWorld(data)).catch(() => {});
    }, 30000);

    // Poll players every 10s
    const playerInterval = setInterval(() => {
      api.getPlayers().then((data) => setPlayers(data.players)).catch(() => {});
    }, 10000);

    // Socket.IO
    const socket = getSocket();

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    // ── Bot events ──────────────────────────────────────────────

    socket.on('bot:position', (data: { bot: string; x: number; y: number; z: number }) => {
      updatePosition(data.bot, data.x, data.y, data.z);
    });

    socket.on('bot:health', (data: { bot: string; health: number; food: number }) => {
      updateHealth(data.bot, data.health, data.food);
    });

    socket.on('bot:state', (data: { bot: string; state: string }) => {
      updateState(data.bot, data.state);
    });

    socket.on('bot:inventory', (data: { bot: string; items: { name: string; count: number; slot: number }[] }) => {
      updateInventory(data.bot, data.items);
    });

    socket.on('activity', (event: any) => {
      pushEvent(event);
    });

    socket.on('bot:spawn', () => {
      api.getBots().then((data) => setBots(data.bots)).catch(() => {});
    });

    socket.on('bot:disconnect', () => {
      api.getBots().then((data) => setBots(data.bots)).catch(() => {});
    });

    socket.on('bot:mode', () => {
      api.getBots().then((data) => setBots(data.bots)).catch(() => {});
    });

    // ── Player events ───────────────────────────────────────────

    socket.on('player:position', (data: { name: string; x: number; y: number; z: number }) => {
      updatePlayerPosition(data.name, data.x, data.y, data.z);
    });

    socket.on('player:join', (data: { name: string }) => {
      addPlayer(data.name);
    });

    socket.on('player:leave', (data: { name: string }) => {
      removePlayer(data.name);
    });

    // ── Chat events ─────────────────────────────────────────────

    socket.on('bot:chat', () => {
      incrementUnreadChats();
    });

    // ── Command events ──────────────────────────────────────────

    socket.on('command:queued', (data: any) => {
      upsertCommand({ ...data, status: 'queued' });
    });

    socket.on('command:started', (data: any) => {
      upsertCommand({ ...data, status: 'started' });
    });

    socket.on('command:succeeded', (data: any) => {
      upsertCommand({ ...data, status: 'succeeded' });
    });

    socket.on('command:failed', (data: any) => {
      upsertCommand({ ...data, status: 'failed' });
    });

    socket.on('command:cancelled', (data: any) => {
      upsertCommand({ ...data, status: 'cancelled' });
    });

    // ── Mission events ──────────────────────────────────────────

    socket.on('mission:created', (data: any) => {
      upsertMission({ ...data, status: data.status ?? 'created' });
    });

    socket.on('mission:updated', (data: any) => {
      upsertMission(data);
    });

    socket.on('mission:completed', (data: any) => {
      upsertMission({ ...data, status: 'completed' });
    });

    socket.on('mission:failed', (data: any) => {
      upsertMission({ ...data, status: 'failed' });
    });

    socket.on('mission:cancelled', (data: any) => {
      upsertMission({ ...data, status: 'cancelled' });
    });

    // ── Marker / Zone / Route events ────────────────────────────

    socket.on('marker:created', (data: any) => {
      upsertMarker(data);
    });

    socket.on('marker:updated', (data: any) => {
      upsertMarker(data);
    });

    socket.on('zone:updated', (data: any) => {
      upsertZone(data);
    });

    socket.on('route:updated', (data: any) => {
      upsertRoute(data);
    });

    // ── Fleet events ────────────────────────────────────────────

    socket.on('squad:updated', (data: any) => {
      upsertSquad(data);
    });

    socket.on('role:updated', (data: any) => {
      upsertAssignment(data);
    });

    // ── Build events ────────────────────────────────────────────

    socket.on('build:started', (data: any) => {
      upsertBuild({ ...data, status: 'started' });
    });

    socket.on('build:progress', (data: any) => {
      upsertBuild({ ...data, status: 'in-progress' });
    });

    socket.on('build:completed', (data: any) => {
      upsertBuild({ ...data, status: 'completed' });
    });

    socket.on('build:cancelled', (data: any) => {
      upsertBuild({ ...data, status: 'cancelled' });
    });

    socket.on('build:bot-status', (data: any) => {
      // Bot-level build status update; push to activity feed
      pushEvent({
        type: 'build:bot-status',
        botName: data.botName ?? data.bot ?? '',
        description: data.description ?? `Build bot status: ${data.status}`,
        timestamp: Date.now(),
        metadata: data,
      });
    });

    // ── Supply chain events ─────────────────────────────────────

    socket.on('chain:started', (data: any) => {
      upsertChain({ ...data, status: 'started' });
    });

    socket.on('chain:completed', (data: any) => {
      upsertChain({ ...data, status: 'completed' });
    });

    socket.on('chain:failed', (data: any) => {
      upsertChain({ ...data, status: 'failed' });
    });

    socket.on('chain:stage-update', (data: any) => {
      upsertChain({ ...data, status: data.status ?? 'running' });
    });

    socket.on('chain:paused', (data: any) => {
      upsertChain({ ...data, status: 'paused' });
    });

    socket.on('chain:cancelled', (data: any) => {
      upsertChain({ ...data, status: 'cancelled' });
    });

    // ── Cleanup ─────────────────────────────────────────────────

    return () => {
      clearInterval(pollInterval);
      clearInterval(worldInterval);
      clearInterval(playerInterval);

      // Bot events
      socket.off('connect');
      socket.off('disconnect');
      socket.off('bot:position');
      socket.off('bot:health');
      socket.off('bot:state');
      socket.off('bot:inventory');
      socket.off('activity');
      socket.off('bot:spawn');
      socket.off('bot:disconnect');
      socket.off('bot:mode');

      // Player events
      socket.off('player:position');
      socket.off('player:join');
      socket.off('player:leave');

      // Chat events
      socket.off('bot:chat');

      // Command events
      socket.off('command:queued');
      socket.off('command:started');
      socket.off('command:succeeded');
      socket.off('command:failed');
      socket.off('command:cancelled');

      // Mission events
      socket.off('mission:created');
      socket.off('mission:updated');
      socket.off('mission:completed');
      socket.off('mission:failed');
      socket.off('mission:cancelled');

      // Marker / Zone / Route events
      socket.off('marker:created');
      socket.off('marker:updated');
      socket.off('zone:updated');
      socket.off('route:updated');

      // Fleet events
      socket.off('squad:updated');
      socket.off('role:updated');

      // Build events
      socket.off('build:started');
      socket.off('build:progress');
      socket.off('build:completed');
      socket.off('build:cancelled');
      socket.off('build:bot-status');

      // Supply chain events
      socket.off('chain:started');
      socket.off('chain:completed');
      socket.off('chain:failed');
      socket.off('chain:stage-update');
      socket.off('chain:paused');
      socket.off('chain:cancelled');
    };
  }, [
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats,
    upsertCommand,
    upsertMission,
    upsertMarker, upsertZone, upsertRoute,
    upsertSquad,
    upsertAssignment,
    upsertBuild,
    upsertChain,
  ]);

  return <>{children}</>;
}
