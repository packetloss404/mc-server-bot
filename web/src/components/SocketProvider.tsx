'use client';

import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { useBotStore, useWorldStore, useFleetStore, useRoleStore, useControlStore } from '@/lib/store';
import { api } from '@/lib/api';

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

    // World planning, fleet, and role initial fetches
    api.getMarkers().then((d) => useWorldStore.getState().setMarkers(d.markers)).catch(() => {});
    api.getZones().then((d) => useWorldStore.getState().setZones(d.zones)).catch(() => {});
    api.getRoutes().then((d) => useWorldStore.getState().setRoutes(d.routes)).catch(() => {});
    api.getSquads().then((d) => useFleetStore.getState().setSquads(d.squads)).catch(() => {});
    api.getRoleAssignments().then((d) => useRoleStore.getState().setAssignments(d.assignments)).catch(() => {});

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

    // World planning events
    socket.on('marker:created', (data: any) => {
      useWorldStore.getState().upsertMarker(data);
    });
    socket.on('marker:updated', (data: any) => {
      useWorldStore.getState().upsertMarker(data);
    });
    socket.on('zone:updated', (data: any) => {
      useWorldStore.getState().upsertZone(data);
    });
    socket.on('route:updated', (data: any) => {
      useWorldStore.getState().upsertRoute(data);
    });

    // Fleet events
    socket.on('squad:updated', () => {
      api.getSquads().then((d) => useFleetStore.getState().setSquads(d.squads)).catch(() => {});
    });

    // Role events
    socket.on('role:updated', () => {
      api.getRoleAssignments().then((d) => useRoleStore.getState().setAssignments(d.assignments)).catch(() => {});
    });

    // Build events
    socket.on('build:started', (data: any) => {
      useBotStore.getState().setActiveBuild(data);
    });
    socket.on('build:progress', (data: any) => {
      const current = useBotStore.getState().activeBuild;
      if (current && current.id === data.id) {
        useBotStore.getState().setActiveBuild({ ...current, ...data });
      }
    });
    socket.on('build:bot-status', (data: any) => {
      const current = useBotStore.getState().activeBuild;
      if (current && current.assignments) {
        const assignments = current.assignments.map((a: any) =>
          a.botName === data.botName ? { ...a, ...data } : a
        );
        useBotStore.getState().setActiveBuild({ ...current, assignments });
      }
    });
    socket.on('build:completed', (data: any) => {
      const current = useBotStore.getState().activeBuild;
      if (current && current.id === data.id) {
        useBotStore.getState().setActiveBuild({ ...current, status: 'completed', ...data });
      }
    });
    socket.on('build:cancelled', (data: any) => {
      const current = useBotStore.getState().activeBuild;
      if (current && current.id === data.id) {
        useBotStore.getState().setActiveBuild(null);
      }
    });

    // Chain events
    socket.on('chain:started', () => {
      api.getChains().then((d) => useBotStore.getState().setChains(d.chains)).catch(() => {});
    });
    socket.on('chain:stage-update', () => {
      api.getChains().then((d) => useBotStore.getState().setChains(d.chains)).catch(() => {});
    });
    socket.on('chain:completed', () => {
      api.getChains().then((d) => useBotStore.getState().setChains(d.chains)).catch(() => {});
    });
    socket.on('chain:failed', () => {
      api.getChains().then((d) => useBotStore.getState().setChains(d.chains)).catch(() => {});
    });
    socket.on('chain:paused', () => {
      api.getChains().then((d) => useBotStore.getState().setChains(d.chains)).catch(() => {});
    });
    socket.on('chain:cancelled', () => {
      api.getChains().then((d) => useBotStore.getState().setChains(d.chains)).catch(() => {});
    });

    // Command events
    socket.on('command:queued', (data: any) => {
      useControlStore.getState().upsertCommand(data);
    });
    socket.on('command:started', (data: any) => {
      useControlStore.getState().upsertCommand(data);
    });
    socket.on('command:succeeded', (data: any) => {
      useControlStore.getState().upsertCommand(data);
    });
    socket.on('command:failed', (data: any) => {
      useControlStore.getState().upsertCommand(data);
    });
    socket.on('command:cancelled', (data: any) => {
      useControlStore.getState().upsertCommand(data);
    });

    // Mission events
    socket.on('mission:created', (data: any) => {
      pushEvent({ type: 'mission_created', botName: data.assigneeIds?.[0] || '', description: data.title || 'Mission created', timestamp: Date.now() });
    });
    socket.on('mission:updated', (data: any) => {
      pushEvent({ type: 'mission_updated', botName: data.assigneeIds?.[0] || '', description: data.title || 'Mission updated', timestamp: Date.now() });
    });
    socket.on('mission:completed', (data: any) => {
      pushEvent({ type: 'mission_completed', botName: data.assigneeIds?.[0] || '', description: data.title || 'Mission completed', timestamp: Date.now() });
    });
    socket.on('mission:failed', (data: any) => {
      pushEvent({ type: 'mission_failed', botName: data.assigneeIds?.[0] || '', description: data.title || 'Mission failed', timestamp: Date.now() });
    });
    socket.on('mission:cancelled', (data: any) => {
      pushEvent({ type: 'mission_cancelled', botName: data.assigneeIds?.[0] || '', description: data.title || 'Mission cancelled', timestamp: Date.now() });
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
      socket.off('marker:created');
      socket.off('marker:updated');
      socket.off('zone:updated');
      socket.off('route:updated');
      socket.off('squad:updated');
      socket.off('role:updated');
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
      socket.off('command:queued');
      socket.off('command:started');
      socket.off('command:succeeded');
      socket.off('command:failed');
      socket.off('command:cancelled');
      socket.off('mission:created');
      socket.off('mission:updated');
      socket.off('mission:completed');
      socket.off('mission:failed');
      socket.off('mission:cancelled');
    };
  }, [
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats,
  ]);

  return <>{children}</>;
}
