'use client';

import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { useBotStore, useControlStore, useMissionStore } from '@/lib/store';
import { api } from '@/lib/api';
import type { CommandRecord, MissionRecord } from '@/lib/api';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const {
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats,
  } = useBotStore();

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

    // Command lifecycle events
    const handleCommand = (data: CommandRecord | { command: CommandRecord }) => {
      const record = 'command' in data ? data.command : data;
      useControlStore.getState().upsertCommand(record);
    };
    socket.on('command:queued', handleCommand);
    socket.on('command:started', handleCommand);
    socket.on('command:succeeded', handleCommand);
    socket.on('command:failed', handleCommand);
    socket.on('command:cancelled', handleCommand);

    // Mission lifecycle events
    const handleMission = (data: MissionRecord | { mission: MissionRecord }) => {
      const record = 'mission' in data ? data.mission : data;
      useMissionStore.getState().upsertMission(record);
    };
    socket.on('mission:created', handleMission);
    socket.on('mission:updated', handleMission);
    socket.on('mission:completed', handleMission);
    socket.on('mission:failed', handleMission);
    socket.on('mission:cancelled', handleMission);

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
      socket.off('command:queued', handleCommand);
      socket.off('command:started', handleCommand);
      socket.off('command:succeeded', handleCommand);
      socket.off('command:failed', handleCommand);
      socket.off('command:cancelled', handleCommand);
      socket.off('mission:created', handleMission);
      socket.off('mission:updated', handleMission);
      socket.off('mission:completed', handleMission);
      socket.off('mission:failed', handleMission);
      socket.off('mission:cancelled', handleMission);
    };
  }, [
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats,
  ]);

  return <>{children}</>;
}
