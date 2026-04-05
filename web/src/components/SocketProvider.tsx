'use client';

import { useEffect } from 'react';
import { getSocket } from '@/lib/socket';
import { useBotStore, useWorldStore, useFleetStore, useRoleStore, useControlStore, useMissionStore } from '@/lib/store';
import { api, normalizeMissionRecord, type BotEvent, type MarkerRecord, type MissionRecord, type RouteRecord, type ZoneRecord } from '@/lib/api';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const {
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, setActivityFeed, updatePlayerPosition, addPlayer, removePlayer,
    incrementUnreadChats,
  } = useBotStore();

  useEffect(() => {
    // Initial fetch
    api.getBots().then((data) => setBots(data.bots)).catch(console.error);
    api.getWorld().then((data) => setWorld(data)).catch(() => {});
    api.getPlayers().then((data) => setPlayers(data.players)).catch(() => {});
    api.getActivity(200).then((data) => setActivityFeed(data.events)).catch(() => {});

    // World planning, fleet, and role initial fetches
    api.getMarkers().then((d) => useWorldStore.getState().setMarkers(d.markers)).catch(() => {});
    api.getZones().then((d) => useWorldStore.getState().setZones(d.zones)).catch(() => {});
    api.getRoutes().then((d) => useWorldStore.getState().setRoutes(d.routes)).catch(() => {});
    api.getSquads().then((d) => useFleetStore.getState().setSquads(d.squads)).catch(() => {});
    api.getRoleAssignments().then((d) => {
      useRoleStore.getState().setAssignments(d.assignments);
      useRoleStore.getState().setOverrides(d.overrides ?? {});
      useRoleStore.getState().setApprovals(d.approvalRequests ?? []);
    }).catch(() => {});
    api.getCommands({ limit: 100 }).then((d) => useControlStore.getState().setCommands(d.commands)).catch(() => {});
    api.getMissions({ limit: 100 }).then((d) => useMissionStore.getState().setMissions(d.missions)).catch(() => {});

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

    socket.on('activity', (event: BotEvent) => {
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

    const refreshCommand = (data: { id: string }) => {
      if (!data?.id) return;
      api.getCommand(data.id)
        .then((result) => useControlStore.getState().upsertCommand(result.command))
        .catch(() => {});
    };

    socket.on('command:queued', refreshCommand);
    socket.on('command:started', refreshCommand);
    socket.on('command:succeeded', refreshCommand);
    socket.on('command:failed', refreshCommand);
    socket.on('command:cancelled', refreshCommand);

    socket.on('mission:created', (data: MissionRecord) => {
      useMissionStore.getState().upsertMission(normalizeMissionRecord(data));
    });
    socket.on('mission:updated', (data: MissionRecord) => {
      useMissionStore.getState().upsertMission(normalizeMissionRecord(data));
    });
    socket.on('mission:completed', (data: MissionRecord) => {
      useMissionStore.getState().upsertMission(normalizeMissionRecord(data));
    });
    socket.on('mission:failed', (data: MissionRecord) => {
      useMissionStore.getState().upsertMission(normalizeMissionRecord(data));
    });
    socket.on('mission:cancelled', (data: MissionRecord) => {
      useMissionStore.getState().upsertMission(normalizeMissionRecord(data));
    });

    // World planning events
    socket.on('marker:created', (data: MarkerRecord) => {
      useWorldStore.getState().upsertMarker(data);
    });
    socket.on('marker:updated', (data: MarkerRecord & { deleted?: boolean }) => {
      if (data?.deleted) {
        useWorldStore.getState().removeMarker(data.id);
        return;
      }
      useWorldStore.getState().upsertMarker(data);
    });
    socket.on('zone:updated', (data: ZoneRecord & { deleted?: boolean }) => {
      if (data?.deleted) {
        useWorldStore.getState().removeZone(data.id);
        return;
      }
      useWorldStore.getState().upsertZone(data);
    });
    socket.on('route:updated', (data: RouteRecord & { deleted?: boolean }) => {
      if (data?.deleted) {
        useWorldStore.getState().removeRoute(data.id);
        return;
      }
      useWorldStore.getState().upsertRoute(data);
    });

    // Fleet events
    socket.on('squad:updated', () => {
      api.getSquads().then((d) => useFleetStore.getState().setSquads(d.squads)).catch(() => {});
    });

    // Role events
    socket.on('role:updated', () => {
      api.getRoleAssignments().then((d) => {
        useRoleStore.getState().setAssignments(d.assignments);
        useRoleStore.getState().setOverrides(d.overrides ?? {});
        useRoleStore.getState().setApprovals(d.approvalRequests ?? []);
      }).catch(() => {});
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
      socket.off('command:queued', refreshCommand);
      socket.off('command:started', refreshCommand);
      socket.off('command:succeeded', refreshCommand);
      socket.off('command:failed', refreshCommand);
      socket.off('command:cancelled', refreshCommand);
      socket.off('mission:created');
      socket.off('mission:updated');
      socket.off('mission:completed');
      socket.off('mission:failed');
      socket.off('mission:cancelled');
      socket.off('marker:created');
      socket.off('marker:updated');
      socket.off('zone:updated');
      socket.off('route:updated');
      socket.off('squad:updated');
      socket.off('role:updated');
    };
  }, [
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
      setPlayers, setActivityFeed, updatePlayerPosition, addPlayer, removePlayer,
      incrementUnreadChats,
    ]);

  return <>{children}</>;
}
