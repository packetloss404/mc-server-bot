'use client';

import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { useBotStore } from '@/lib/store';
import { api } from '@/lib/api';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const {
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats,
    setActiveBuild, updateBuildProgress, updateBuildBotStatus,
    setChains, updateChainStage, updateChainStatus,
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

    // Build events
    socket.on('build:started', (data: any) => {
      setActiveBuild(data.build ?? data);
    });

    socket.on('build:progress', (data: { buildId: string; botName: string; blocksPlaced: number; currentY: number }) => {
      updateBuildProgress(data.buildId, data.botName, data.blocksPlaced, data.currentY);
    });

    socket.on('build:bot-status', (data: { buildId: string; botName: string; status: string }) => {
      updateBuildBotStatus(data.buildId, data.botName, data.status);
    });

    socket.on('build:completed', (data: { buildId: string }) => {
      const current = useBotStore.getState().activeBuild;
      if (current && current.id === data.buildId) {
        setActiveBuild({ ...current, status: 'completed' });
      }
    });

    socket.on('build:cancelled', () => {
      setActiveBuild(null);
    });

    // Chain events
    socket.on('chain:started', () => {
      api.getChains().then((data) => setChains(data.chains)).catch(() => {});
    });

    socket.on('chain:stage-update', (data: { chainId: string; stageIndex: number; stage: any }) => {
      updateChainStage(data.chainId, data.stageIndex, data.stage);
    });

    socket.on('chain:completed', (data: { chainId: string }) => {
      updateChainStatus(data.chainId, 'completed');
    });

    socket.on('chain:failed', (data: { chainId: string }) => {
      updateChainStatus(data.chainId, 'failed');
    });

    socket.on('chain:paused', (data: { chainId: string }) => {
      updateChainStatus(data.chainId, 'paused');
    });

    socket.on('chain:cancelled', () => {
      api.getChains().then((data) => setChains(data.chains)).catch(() => {});
    });

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
      socket.off('build:started');
      socket.off('build:progress');
      socket.off('build:bot-status');
      socket.off('build:completed');
      socket.off('build:cancelled');
      socket.off('chain:started');
      socket.off('chain:stage-update');
      socket.off('chain:completed');
      socket.off('chain:failed');
      socket.off('chain:paused');
      socket.off('chain:cancelled');
    };
  }, [
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats,
    setActiveBuild, updateBuildProgress, updateBuildBotStatus,
    setChains, updateChainStage, updateChainStatus,
  ]);

  return <>{children}</>;
}
