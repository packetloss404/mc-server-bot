'use client';

import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { useBotStore, useRoleStore } from '@/lib/store';
import { api } from '@/lib/api';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const {
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats,
  } = useBotStore();

  const { setOverrides, setMissions } = useRoleStore();

  useEffect(() => {
    // Fetch all data (used on initial load and socket reconnection)
    const fetchAll = () => {
      api.getBots().then((data) => setBots(data.bots)).catch(console.error);
      api.getWorld().then((data) => setWorld(data)).catch(() => {});
      api.getPlayers().then((data) => setPlayers(data.players)).catch(() => {});
      api.getMissions().then((data) => setMissions(data.missions)).catch(() => {});
    };

    // Initial fetch
    fetchAll();

    // Poll bots every 30s as a reconnect-recovery fallback
    const pollInterval = setInterval(() => {
      api.getBots().then((data) => setBots(data.bots)).catch(() => {});
    }, 30000);

    // Poll world state every 60s as fallback
    const worldInterval = setInterval(() => {
      api.getWorld().then((data) => setWorld(data)).catch(() => {});
    }, 60000);

    // Poll players every 60s as fallback
    const playerInterval = setInterval(() => {
      api.getPlayers().then((data) => setPlayers(data.players)).catch(() => {});
    }, 60000);

    // Poll role overrides and missions every 30s
    const roleInterval = setInterval(() => {
      api.getMissions().then((data) => setMissions(data.missions)).catch(() => {});
    }, 30000);

    // Socket.IO - primary data path
    const socket = getSocket();

    socket.on('connect', () => {
      setConnected(true);
      // On reconnect, immediately re-fetch all data to catch anything missed
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

    // World time updates from backend (merge with existing world state)
    socket.on('world:time', (data: { timeOfDay: string; isRaining: boolean }) => {
      const prev = useBotStore.getState().world;
      setWorld({
        timeOfDay: data.timeOfDay ?? prev?.timeOfDay ?? null,
        timeOfDayTicks: prev?.timeOfDayTicks ?? null,
        day: prev?.day ?? null,
        isRaining: data.isRaining ?? prev?.isRaining ?? null,
        onlineBots: prev?.onlineBots ?? 0,
      });
    });

    // Squad and role events
    socket.on('squad:updated', (_data: any) => {
      // TODO: dispatch to squad store when available
    });

    socket.on('role:updated', (_data: any) => {
      // TODO: dispatch to role store when available
    });

    return () => {
      clearInterval(pollInterval);
      clearInterval(worldInterval);
      clearInterval(playerInterval);
      clearInterval(roleInterval);
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
      socket.off('world:time');
      socket.off('squad:updated');
      socket.off('role:updated');
    };
  }, [
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats, setOverrides, setMissions,
  ]);

  return <>{children}</>;
}
