'use client';

import { useEffect, useCallback } from 'react';
import { getSocket } from '@/lib/socket';
import {
  useBotStore,
  useControlStore,
  useFleetStore,
  useRoleStore,
  useWorldStore,
  useMissionStore,
  useBuildStore,
  useChainStore,
} from '@/lib/store';
import { api } from '@/lib/api';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const {
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats,
  } = useBotStore();

  const fetchAll = useCallback(() => {
    api.getBots().then((data) => setBots(data.bots)).catch(console.error);
    api.getWorld().then((data) => setWorld(data)).catch(() => {});
    api.getPlayers().then((data) => setPlayers(data.players)).catch(() => {});
  }, [setBots, setWorld, setPlayers]);

  useEffect(() => {
    // Initial fetch
    fetchAll();

    // Polling is a fallback — sockets already push real-time updates.
    // Long intervals to keep server CPU low; sockets cover the active path.
    const pollInterval = setInterval(() => {
      api.getBots().then((data) => setBots(data.bots)).catch(() => {});
    }, 15000);

    const worldInterval = setInterval(() => {
      api.getWorld().then((data) => setWorld(data)).catch(() => {});
    }, 60000);

    const playerInterval = setInterval(() => {
      api.getPlayers().then((data) => setPlayers(data.players)).catch(() => {});
    }, 30000);

    // Socket.IO
    const socket = getSocket();

    socket.on('connect', () => {
      setConnected(true);
      // Re-fetch all state on reconnection to avoid stale data
      fetchAll();
    });
    socket.on('disconnect', () => setConnected(false));

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

    // Player events
    socket.on('player:position', (data: { name: string; x: number; y: number; z: number }) => {
      updatePlayerPosition(data.name, data.x, data.y, data.z);
    });

    socket.on('player:join', (data: { name: string }) => {
      addPlayer(data.name);
    });

    socket.on('player:leave', (data: { name: string }) => {
      removePlayer(data.name);
    });

    // Chat events
    socket.on('bot:chat', () => {
      incrementUnreadChats();
    });

    // ── Control platform events: on any change, refetch the affected list. ──
    // Refetches are debounced so bursty events (e.g. build:progress per-block)
    // collapse into one HTTP call per ~500ms.
    const debounce = (fn: () => void, ms = 500) => {
      let t: ReturnType<typeof setTimeout> | null = null;
      return () => {
        if (t) return;
        t = setTimeout(() => { t = null; fn(); }, ms);
      };
    };
    const refetchMarkers = debounce(() => { api.getMarkers().then((d) => useWorldStore.getState().setMarkers(d.markers)).catch(() => {}); });
    const refetchZones = debounce(() => { api.getZones().then((d) => useWorldStore.getState().setZones(d.zones)).catch(() => {}); });
    const refetchRoutes = debounce(() => { api.getRoutes().then((d) => useWorldStore.getState().setRoutes(d.routes)).catch(() => {}); });
    const refetchSquads = debounce(() => { api.getSquads().then((d) => useFleetStore.getState().setSquads(d.squads)).catch(() => {}); });
    const refetchMissions = debounce(() => { api.getMissions().then((d) => useMissionStore.getState().setMissions(d.missions)).catch(() => {}); });
    const refetchCommands = debounce(() => { api.getCommands().then((d) => useControlStore.getState().setCommands(d.commands)).catch(() => {}); });
    const refetchBuilds = debounce(() => { api.getBuilds().then((d) => useBuildStore.getState().setBuilds(d.builds)).catch(() => {}); }, 1000);
    const refetchChains = debounce(() => { api.getChains().then((d) => useChainStore.getState().setChains(d.chains)).catch(() => {}); });
    const refetchRoles = debounce(() => { api.getRoleAssignments().then((d) => useRoleStore.getState().setAssignments?.(d.assignments)).catch(() => {}); });

    socket.on('marker:created', refetchMarkers);
    socket.on('marker:updated', refetchMarkers);
    socket.on('marker:deleted', refetchMarkers);
    socket.on('zone:created', refetchZones);
    socket.on('zone:updated', refetchZones);
    socket.on('zone:deleted', refetchZones);
    socket.on('route:created', refetchRoutes);
    socket.on('route:updated', refetchRoutes);
    socket.on('route:deleted', refetchRoutes);

    socket.on('squad:updated', refetchSquads);
    socket.on('squad:deleted', refetchSquads);
    socket.on('role:updated', refetchRoles);

    socket.on('mission:created', refetchMissions);
    socket.on('mission:updated', refetchMissions);
    socket.on('mission:completed', refetchMissions);
    socket.on('mission:failed', refetchMissions);
    socket.on('mission:cancelled', refetchMissions);

    socket.on('command:created', refetchCommands);
    socket.on('command:updated', refetchCommands);
    socket.on('command:completed', refetchCommands);
    socket.on('command:failed', refetchCommands);

    socket.on('build:started', refetchBuilds);
    socket.on('build:progress', refetchBuilds);
    socket.on('build:completed', refetchBuilds);
    socket.on('build:cancelled', refetchBuilds);
    socket.on('build:bot-status', refetchBuilds);

    socket.on('chain:started', refetchChains);
    socket.on('chain:stage-update', refetchChains);
    socket.on('chain:paused', refetchChains);
    socket.on('chain:cancelled', refetchChains);
    socket.on('chain:completed', refetchChains);
    socket.on('chain:failed', refetchChains);

    return () => {
      clearInterval(pollInterval);
      clearInterval(worldInterval);
      clearInterval(playerInterval);
      socket.off('connect');
      socket.off('disconnect');
      socket.off('bot:position');
      socket.off('bot:health');
      socket.off('bot:state');
      socket.off('bot:inventory');
      socket.off('activity');
      socket.off('bot:spawn');
      socket.off('bot:disconnect');
      socket.off('player:position');
      socket.off('player:join');
      socket.off('player:leave');
      socket.off('bot:chat');
      socket.off('marker:created'); socket.off('marker:updated'); socket.off('marker:deleted');
      socket.off('zone:created'); socket.off('zone:updated'); socket.off('zone:deleted');
      socket.off('route:created'); socket.off('route:updated'); socket.off('route:deleted');
      socket.off('squad:updated'); socket.off('squad:deleted');
      socket.off('role:updated');
      socket.off('mission:created'); socket.off('mission:updated'); socket.off('mission:completed');
      socket.off('mission:failed'); socket.off('mission:cancelled');
      socket.off('command:created'); socket.off('command:updated'); socket.off('command:completed');
      socket.off('command:failed');
      socket.off('build:started'); socket.off('build:progress'); socket.off('build:completed');
      socket.off('build:cancelled'); socket.off('build:bot-status');
      socket.off('chain:started'); socket.off('chain:stage-update'); socket.off('chain:paused');
      socket.off('chain:cancelled'); socket.off('chain:completed'); socket.off('chain:failed');
    };
  }, [
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats, fetchAll,
  ]);

  return <>{children}</>;
}
