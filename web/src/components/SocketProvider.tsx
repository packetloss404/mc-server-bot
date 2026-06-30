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
  useCampaignStore,
  useDecisionStore,
  useMovementTrailStore,
  type DecisionRecord,
} from '@/lib/store';
import { api, safeFetch } from '@/lib/api';
import { setFaviconStatus } from '@/lib/favicon';
import { toast as showToast, showBanner, dismissBanner } from '@/components/Toast';

const CONNECTION_BANNER_ID = 'socket-connection-lost';

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const {
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition,
  } = useBotStore();

  const fetchAll = useCallback(() => {
    safeFetch(() => api.getBots(), { bots: [] }, 'getBots').then((data) => setBots(data.bots));
    safeFetch(() => api.getWorld(), null as any, 'getWorld').then((data) => { if (data) setWorld(data); });
    safeFetch(() => api.getPlayers(), { players: [] }, 'getPlayers').then((data) => setPlayers(data.players));
    safeFetch(() => api.listCampaigns(), { campaigns: [] }, 'listCampaigns').then((d) => useCampaignStore.getState().setCampaigns(d.campaigns));
  }, [setBots, setWorld, setPlayers]);

  useEffect(() => {
    // Initial fetch
    fetchAll();

    // Polling is a fallback — sockets already push real-time updates.
    // Long intervals to keep server CPU low; sockets cover the active path.
    const pollInterval = setInterval(() => {
      safeFetch(() => api.getBots(), { bots: [] }, 'getBots(poll)').then((data) => setBots(data.bots));
    }, 15000);

    const worldInterval = setInterval(() => {
      safeFetch(() => api.getWorld(), null as any, 'getWorld(poll)').then((data) => { if (data) setWorld(data); });
    }, 60000);

    const playerInterval = setInterval(() => {
      safeFetch(() => api.getPlayers(), { players: [] }, 'getPlayers(poll)').then((data) => setPlayers(data.players));
    }, 30000);

    // Socket.IO
    const socket = getSocket();

    // ── Consolidated connect/disconnect listeners ──────────────────────────
    // Previously these events were bound twice (once for store state, again
    // for favicon/banner UI). On every reconnect both handlers fired in
    // duplicate. We now register a single named handler per event that runs
    // all side-effects in sequence, and pair every `.on` with a `.off` that
    // references the exact handler so cleanup is precise.
    const onConnect = () => {
      setConnected(true);
      // Re-fetch all state on reconnection to avoid stale data.
      fetchAll();
      // Favicon + banner: clear the "lost connection" UI.
      setFaviconStatus('green');
      dismissBanner(CONNECTION_BANNER_ID);
    };
    const onDisconnect = () => {
      setConnected(false);
      setFaviconStatus('red');
      showBanner('Lost connection to server — retrying...', 'warning', {
        dismissible: false,
        id: CONNECTION_BANNER_ID,
      });
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

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
      api.getBots().then((data) => {
        setBots(data.bots);
        // Drop movement trails for any bot that's no longer in the list, so
        // disconnected bots don't leak their ring buffers indefinitely.
        useMovementTrailStore.getState().pruneToActive(data.bots.map((b: { name: string }) => b.name));
      }).catch(() => {});
    });

    // Player events. Server emits `{ player, x, y, z }` (see api.ts).
    socket.on('player:position', (data: { player: string; x: number; y: number; z: number }) => {
      if (data && data.player && typeof data.x === 'number') {
        updatePlayerPosition(data.player, data.x, data.y, data.z);
      }
    });

    // `player:join`, `player:leave`, and `bot:chat` listeners removed —
    // the server never emits those names. Player presence is handled by the
    // 30s `getPlayers` poll above; chat unread counts come from the chat tab's
    // own state. Re-add listeners here once the server actually emits them.

    // ── Newly wired listeners ──────────────────────────────────────────────
    const onBotDied = (data: { bot: string; position: { x: number; y: number; z: number } | null }) => {
      const pos = data.position
        ? `${Math.round(data.position.x)}, ${Math.round(data.position.y)}, ${Math.round(data.position.z)}`
        : 'unknown location';
      showToast(`${data.bot} died at ${pos}`, 'error');
    };
    socket.on('bot:died', onBotDied);

    // ── Security: impersonation alert ──────────────────────────────────────
    // Someone logged in under a bot's username; the server has quarantined the
    // bot. Surface a persistent error toast so the operator sees it live.
    const onSecurityAlert = (incident: { botName?: string; signal?: string; reason?: string } | null) => {
      if (!incident || !incident.botName) return;
      showToast(
        `Impersonation detected: someone is using ${incident.botName}'s name (${incident.signal ?? 'unknown'}). Bot quarantined.`,
        'error',
      );
    };
    socket.on('security:alert', onSecurityAlert);

    // (player:position is handled by the single listener registered above with
    // the server's `{ player, x, y, z }` payload shape.)

    // ── Decision trace listener ────────────────────────────────────────────
    // Pushes each forwarded decision into the per-bot Zustand buffer that
    // useBotDecisions reads. Server emits TraceRecord-shaped payloads
    // (id, type, botName, task, timestamp, summary, decision, candidates,
    // details). We normalize into DecisionRecord at the boundary.
    const onBotDecision = (raw: Record<string, unknown> | null | undefined) => {
      if (!raw || typeof raw !== 'object') return;
      const botName = typeof raw.botName === 'string' ? raw.botName : '';
      if (!botName) return;
      const record: DecisionRecord = {
        id: String(raw.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        type: String(raw.type ?? 'action'),
        botName,
        task: typeof raw.task === 'string' ? raw.task : undefined,
        timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
        summary: typeof raw.summary === 'string' ? raw.summary : undefined,
        decision: typeof raw.decision === 'string' ? raw.decision : undefined,
        action: typeof raw.action === 'string'
          ? raw.action
          : (typeof raw.decision === 'string' ? raw.decision : undefined),
        reason: typeof raw.reason === 'string'
          ? raw.reason
          : (typeof raw.summary === 'string' ? raw.summary : undefined),
        target: typeof raw.target === 'string' ? raw.target : undefined,
        metadata: (raw.metadata && typeof raw.metadata === 'object')
          ? raw.metadata as Record<string, unknown>
          : undefined,
        alternatives: Array.isArray(raw.alternatives)
          ? raw.alternatives as DecisionRecord['alternatives']
          : undefined,
        candidates: Array.isArray(raw.candidates)
          ? raw.candidates as DecisionRecord['candidates']
          : undefined,
        details: (raw.details && typeof raw.details === 'object')
          ? raw.details as Record<string, unknown>
          : undefined,
      };
      useDecisionStore.getState().pushDecision(botName, record);
    };
    socket.on('bot:decision', onBotDecision);

    // ── Favicon-as-status (reconnect attempts) ────────────────────────────
    // Drive favicon from connection state. Set initial color from current
    // socket state so we don't wait for the next event. The connected/
    // disconnected transitions are handled by onConnect/onDisconnect above —
    // only the in-flight reconnect indicator is bound here.
    setFaviconStatus(socket.connected ? 'green' : 'amber');

    const onReconnectAttempt = () => {
      setFaviconStatus('amber');
    };
    // socket.io-client emits these on the socket's manager; bind via .io.
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.io.on('reconnect_error', onReconnectAttempt);

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
    const refetchCampaigns = debounce(() => { api.listCampaigns().then((d) => useCampaignStore.getState().setCampaigns(d.campaigns)).catch(() => {}); });

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

    // Backend emits queued/started/succeeded/failed/cancelled (COMMAND_EVENTS in
    // src/control/CommandTypes.ts) — not created/updated/completed.
    socket.on('command:queued', refetchCommands);
    socket.on('command:started', refetchCommands);
    socket.on('command:succeeded', refetchCommands);
    socket.on('command:failed', refetchCommands);
    socket.on('command:cancelled', refetchCommands);

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

    socket.on('campaign:created', refetchCampaigns);
    socket.on('campaign:started', refetchCampaigns);
    socket.on('campaign:structure-started', refetchCampaigns);
    socket.on('campaign:structure-completed', refetchCampaigns);
    socket.on('campaign:structure-failed', refetchCampaigns);
    socket.on('campaign:completed', refetchCampaigns);
    socket.on('campaign:failed', refetchCampaigns);
    socket.on('campaign:cancelled', refetchCampaigns);
    socket.on('campaign:paused', refetchCampaigns);
    socket.on('campaign:resumed', refetchCampaigns);
    socket.on('campaign:deleted', refetchCampaigns);

    return () => {
      clearInterval(pollInterval);
      clearInterval(worldInterval);
      clearInterval(playerInterval);
      // NOTE: handlers registered with named refs above (onBotDied,
      // onReconnectAttempt, onConnect, onDisconnect, onBotDecision) are
      // .off()'d with their refs. All other socket.off('event') calls below
      // rely on the invariant that each event has exactly one registered
      // listener in this provider — socket.io removes all listeners for the
      // event in that form. If a future contributor adds a second listener
      // for any of these events, both will be removed; in that case, name
      // the handler and pass it to .off() like the ones at the top here.
      socket.off('bot:died', onBotDied);
      socket.off('security:alert', onSecurityAlert);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.io.off('reconnect_error', onReconnectAttempt);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('bot:position');
      socket.off('bot:health');
      socket.off('bot:state');
      socket.off('bot:inventory');
      socket.off('activity');
      socket.off('bot:spawn');
      socket.off('bot:disconnect');
      socket.off('player:position');
      socket.off('marker:created'); socket.off('marker:updated'); socket.off('marker:deleted');
      socket.off('zone:created'); socket.off('zone:updated'); socket.off('zone:deleted');
      socket.off('route:created'); socket.off('route:updated'); socket.off('route:deleted');
      socket.off('squad:updated'); socket.off('squad:deleted');
      socket.off('role:updated');
      socket.off('mission:created'); socket.off('mission:updated'); socket.off('mission:completed');
      socket.off('mission:failed'); socket.off('mission:cancelled');
      socket.off('command:queued'); socket.off('command:started'); socket.off('command:succeeded');
      socket.off('command:failed'); socket.off('command:cancelled');
      socket.off('build:started'); socket.off('build:progress'); socket.off('build:completed');
      socket.off('build:cancelled'); socket.off('build:bot-status');
      socket.off('chain:started'); socket.off('chain:stage-update'); socket.off('chain:paused');
      socket.off('chain:cancelled'); socket.off('chain:completed'); socket.off('chain:failed');
      socket.off('campaign:created'); socket.off('campaign:started');
      socket.off('campaign:structure-started'); socket.off('campaign:structure-completed');
      socket.off('campaign:structure-failed');
      socket.off('campaign:completed'); socket.off('campaign:failed');
      socket.off('campaign:cancelled'); socket.off('campaign:paused');
      socket.off('campaign:resumed'); socket.off('campaign:deleted');
      socket.off('bot:decision', onBotDecision);
    };
  }, [
    setBots, updatePosition, updateHealth, updateState,
    updateInventory, pushEvent, setConnected, setWorld,
    setPlayers, updatePlayerPosition, fetchAll,
  ]);

  return <>{children}</>;
}
