'use client';

import { create } from 'zustand';
import type {
  BotStatus, BotEvent, WorldState,
  SquadRecord, RoleAssignmentRecord, RoleOverrideRecord, RoleApprovalRecord,
  CommandRecord, MissionRecord,
  Marker, Zone, Route, Routine, RoutineStep, RoutineDraft, BuildRecord,
  Campaign,
} from './api';

export interface BotLiveData extends BotStatus {
  health?: number;
  food?: number;
  inventory?: { name: string; count: number; slot: number }[];
}

export interface PlayerData {
  name: string;
  position: { x: number; y: number; z: number } | null;
  isOnline: boolean;
}

interface BotStore {
  botsById: Record<string, BotLiveData>;
  botList: BotLiveData[];
  playersById: Record<string, PlayerData>;
  playerList: PlayerData[];
  activityFeed: BotEvent[];
  connected: boolean;
  world: WorldState | null;
  unreadChats: number;
  activeBuild: BuildRecord | null;
  chains: any[];

  setBots: (bots: BotStatus[]) => void;
  updatePosition: (bot: string, x: number, y: number, z: number) => void;
  updateHealth: (bot: string, health: number, food: number) => void;
  updateState: (bot: string, state: string) => void;
  updateInventory: (bot: string, items: { name: string; count: number; slot: number }[]) => void;
  pushEvent: (event: BotEvent) => void;
  setConnected: (connected: boolean) => void;
  setWorld: (world: WorldState) => void;
  setPlayers: (players: PlayerData[]) => void;
  updatePlayerPosition: (name: string, x: number, y: number, z: number) => void;
  addPlayer: (name: string) => void;
  removePlayer: (name: string) => void;
  setActiveBuild: (build: BuildRecord | null) => void;
  setChains: (chains: any[]) => void;
  incrementUnreadChats: () => void;
  resetUnreadChats: () => void;
}

function toBotList(byId: Record<string, BotLiveData>): BotLiveData[] {
  return Object.values(byId);
}

function toPlayerList(byId: Record<string, PlayerData>): PlayerData[] {
  return Object.values(byId);
}

function updateBot(
  state: BotStore,
  key: string,
  patch: Partial<BotLiveData>,
): Partial<BotStore> {
  const existing = state.botsById[key];
  if (!existing) return {};
  const updated = { ...state.botsById, [key]: { ...existing, ...patch } };
  return { botsById: updated, botList: toBotList(updated) };
}

export const useBotStore = create<BotStore>((set) => ({
  botsById: {},
  botList: [],
  playersById: {},
  playerList: [],
  activityFeed: [],
  connected: false,
  world: null,
  unreadChats: 0,
  activeBuild: null,
  chains: [],

  setBots: (bots) =>
    set((state) => {
      const updated = { ...state.botsById };
      for (const bot of bots) {
        const key = bot.name.toLowerCase();
        updated[key] = { ...(updated[key] || {}), ...bot } as BotLiveData;
      }
      return { botsById: updated, botList: toBotList(updated) };
    }),

  updatePosition: (bot, x, y, z) =>
    set((state) => updateBot(state, bot.toLowerCase(), { position: { x, y, z } })),

  updateHealth: (bot, health, food) =>
    set((state) => updateBot(state, bot.toLowerCase(), { health, food })),

  updateState: (bot, newState) =>
    set((state) => updateBot(state, bot.toLowerCase(), { state: newState })),

  updateInventory: (bot, items) =>
    set((state) => updateBot(state, bot.toLowerCase(), { inventory: items })),

  pushEvent: (event) =>
    set((state) => ({
      activityFeed: [event, ...state.activityFeed].slice(0, 200),
    })),

  setConnected: (connected) => set({ connected }),

  setWorld: (world) => set({ world }),

  setPlayers: (players) =>
    set(() => {
      const byId: Record<string, PlayerData> = {};
      for (const p of players) {
        byId[p.name.toLowerCase()] = p;
      }
      return { playersById: byId, playerList: toPlayerList(byId) };
    }),

  updatePlayerPosition: (name, x, y, z) =>
    set((state) => {
      const key = name.toLowerCase();
      const existing = state.playersById[key] || { name, isOnline: true, position: null };
      const updated = { ...state.playersById, [key]: { ...existing, position: { x, y, z } } };
      return { playersById: updated, playerList: toPlayerList(updated) };
    }),

  addPlayer: (name) =>
    set((state) => {
      const key = name.toLowerCase();
      const updated = { ...state.playersById, [key]: { name, position: null, isOnline: true } };
      return { playersById: updated, playerList: toPlayerList(updated) };
    }),

  removePlayer: (name) =>
    set((state) => {
      const key = name.toLowerCase();
      const existing = state.playersById[key];
      if (!existing) return {};
      const updated = { ...state.playersById, [key]: { ...existing, isOnline: false } };
      return { playersById: updated, playerList: toPlayerList(updated) };
    }),

  setActiveBuild: (build) => set({ activeBuild: build }),
  setChains: (chains) => set({ chains }),

  incrementUnreadChats: () =>
    set((state) => ({ unreadChats: state.unreadChats + 1 })),

  resetUnreadChats: () => set({ unreadChats: 0 }),
}));

// ─── Control Store (multi-bot selection & command history) ───

interface ControlStore {
  selectedBotIds: Set<string>;
  commandHistory: CommandRecord[];
  toggleBotSelection: (botName: string) => void;
  selectBot: (botName: string) => void;
  deselectBot: (botName: string) => void;
  clearSelection: () => void;
  selectAll: (botNames: string[]) => void;
  setSelection: (botNames: string[]) => void;
  setCommands: (commands: CommandRecord[]) => void;
  upsertCommand: (command: CommandRecord) => void;
}

export const useControlStore = create<ControlStore>((set) => ({
  selectedBotIds: new Set(),
  commandHistory: [],
  toggleBotSelection: (botName) =>
    set((state) => {
      const next = new Set(state.selectedBotIds);
      const key = botName.toLowerCase();
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { selectedBotIds: next };
    }),
  selectBot: (botName) =>
    set((state) => {
      const key = botName.toLowerCase();
      if (state.selectedBotIds.has(key)) return state;
      const next = new Set(state.selectedBotIds);
      next.add(key);
      return { selectedBotIds: next };
    }),
  deselectBot: (botName) =>
    set((state) => {
      const key = botName.toLowerCase();
      if (!state.selectedBotIds.has(key)) return state;
      const next = new Set(state.selectedBotIds);
      next.delete(key);
      return { selectedBotIds: next };
    }),
  clearSelection: () => set({ selectedBotIds: new Set() }),
  selectAll: (botNames) => set({ selectedBotIds: new Set(botNames.map((n) => n.toLowerCase())) }),
  setSelection: (botNames) => set({ selectedBotIds: new Set(botNames.map((n) => n.toLowerCase())) }),
  setCommands: (commands) => set({ commandHistory: commands }),
  upsertCommand: (command) =>
    set((state) => {
      const idx = state.commandHistory.findIndex((c) => c.id === command.id);
      if (idx >= 0) {
        const next = [...state.commandHistory];
        next[idx] = { ...next[idx], ...command };
        next.sort((a, b) => b.createdAt - a.createdAt);
        return { commandHistory: next };
      }
      return {
        commandHistory: [command, ...state.commandHistory]
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 100),
      };
    }),
}));

// ─── Fleet Store (squads) ───

export type Squad = SquadRecord;

interface FleetStore {
  squads: Squad[];
  selectedSquadId: string | null;
  setSquads: (squads: Squad[]) => void;
  upsertSquad: (squad: Squad) => void;
  removeSquad: (id: string) => void;
  selectSquad: (id: string | null) => void;
}

export const useFleetStore = create<FleetStore>((set) => ({
  squads: [],
  selectedSquadId: null,
  setSquads: (squads) => set({ squads }),
  upsertSquad: (squad) =>
    set((state) => {
      const idx = state.squads.findIndex((s) => s.id === squad.id);
      if (idx >= 0) {
        const next = [...state.squads];
        next[idx] = squad;
        return { squads: next };
      }
      return { squads: [...state.squads, squad] };
    }),
  removeSquad: (id) =>
    set((state) => ({
      squads: state.squads.filter((s) => s.id !== id),
      selectedSquadId: state.selectedSquadId === id ? null : state.selectedSquadId,
    })),
  selectSquad: (id) => set({ selectedSquadId: id }),
}));

// ─── Role Store (role assignments, overrides, approvals) ───

interface RoleStore {
  assignments: RoleAssignmentRecord[];
  overrides: Record<string, RoleOverrideRecord>;
  approvals: RoleApprovalRecord[];
  setAssignments: (assignments: RoleAssignmentRecord[]) => void;
  setOverrides: (overrides: Record<string, RoleOverrideRecord>) => void;
  setApprovals: (approvals: RoleApprovalRecord[]) => void;
  upsertAssignment: (assignment: RoleAssignmentRecord) => void;
  removeAssignment: (id: string) => void;
}

export const useRoleStore = create<RoleStore>((set) => ({
  assignments: [],
  overrides: {},
  approvals: [],

  setAssignments: (assignments) => set({ assignments }),
  setOverrides: (overrides) => set({ overrides }),
  setApprovals: (approvals) => set({ approvals }),
  upsertAssignment: (assignment) =>
    set((s) => {
      const idx = s.assignments.findIndex((a) => a.id === assignment.id);
      if (idx >= 0) {
        const next = [...s.assignments];
        next[idx] = assignment;
        return { assignments: next };
      }
      return { assignments: [...s.assignments, assignment] };
    }),
  removeAssignment: (id) =>
    set((s) => ({ assignments: s.assignments.filter((a) => a.id !== id) })),

  getOverrideForBot: (botName: string) => {
    const key = botName.toLowerCase();
    const overrides = useRoleStore.getState().overrides;
    return overrides[key] || overrides[botName] || null;
  },
  getBlockedMissionForBot: (_botName: string) => {
    // Mission store not yet available in this build — return null
    return null;
  },
}));

// ─── World Store (markers, zones, routes) ───

interface WorldStore {
  markers: Marker[];
  zones: Zone[];
  routes: Route[];
  upsertMarker: (marker: Marker) => void;
  setMarkers: (markers: Marker[]) => void;
  removeMarker: (id: string) => void;
  upsertZone: (zone: Zone) => void;
  setZones: (zones: Zone[]) => void;
  removeZone: (id: string) => void;
  upsertRoute: (route: Route) => void;
  setRoutes: (routes: Route[]) => void;
  removeRoute: (id: string) => void;
}

export const useWorldStore = create<WorldStore>((set) => ({
  markers: [],
  zones: [],
  routes: [],

  upsertMarker: (marker) =>
    set((state) => {
      const idx = state.markers.findIndex((m) => m.id === marker.id);
      if (idx >= 0) {
        const next = [...state.markers];
        next[idx] = marker;
        return { markers: next };
      }
      return { markers: [...state.markers, marker] };
    }),
  setMarkers: (markers) => set({ markers }),
  removeMarker: (id) =>
    set((state) => ({ markers: state.markers.filter((m) => m.id !== id) })),

  upsertZone: (zone) =>
    set((state) => {
      const idx = state.zones.findIndex((z) => z.id === zone.id);
      if (idx >= 0) {
        const next = [...state.zones];
        next[idx] = zone;
        return { zones: next };
      }
      return { zones: [...state.zones, zone] };
    }),
  setZones: (zones) => set({ zones }),
  removeZone: (id) =>
    set((state) => ({ zones: state.zones.filter((z) => z.id !== id) })),

  upsertRoute: (route) =>
    set((state) => {
      const idx = state.routes.findIndex((r) => r.id === route.id);
      if (idx >= 0) {
        const next = [...state.routes];
        next[idx] = route;
        return { routes: next };
      }
      return { routes: [...state.routes, route] };
    }),
  setRoutes: (routes) => set({ routes }),
  removeRoute: (id) =>
    set((state) => ({ routes: state.routes.filter((r) => r.id !== id) })),
}));

// ─── Routine Store ───

interface RoutineStore {
  routines: Routine[];
  recording: boolean;
  draft: RoutineDraft | null;
  setRoutines: (routines: Routine[]) => void;
  addRoutine: (routine: Routine) => void;
  updateRoutine: (routine: Routine) => void;
  removeRoutine: (id: string) => void;
  setRecording: (recording: boolean, draft?: RoutineDraft | null) => void;
}

export const useRoutineStore = create<RoutineStore>((set) => ({
  routines: [],
  recording: false,
  draft: null,

  setRoutines: (routines) => set({ routines }),
  addRoutine: (routine) =>
    set((state) => ({ routines: [...state.routines, routine] })),
  updateRoutine: (routine) =>
    set((state) => {
      const idx = state.routines.findIndex((r) => r.id === routine.id);
      if (idx >= 0) {
        const next = [...state.routines];
        next[idx] = routine;
        return { routines: next };
      }
      return { routines: [...state.routines, routine] };
    }),
  removeRoutine: (id) =>
    set((state) => ({ routines: state.routines.filter((r) => r.id !== id) })),
  setRecording: (recording, draft = null) => set({ recording, draft }),
}));

// ─── Schematic Placement Store ───

interface SchematicPlacement {
  filename: string;
  sizeX: number;
  sizeZ: number;
  sizeY: number;
}

export interface PendingPlacement {
  id: string;
  schematicFile: string;
  origin: { x: number; y: number; z: number };
  /** Optional display label (defaults to filename + count). */
  label?: string;
}

interface SchematicPlacementStore {
  // Existing single-placement API (preserved for backward compatibility).
  placement: SchematicPlacement | null;
  placedOrigin: { x: number; y: number; z: number } | null;
  startPlacement: (placement: SchematicPlacement) => void;
  cancelPlacement: () => void;
  setPlacedOrigin: (origin: { x: number; y: number; z: number }) => void;

  /** A separate list of staged placements for multi-structure queuing. */
  pending: PendingPlacement[];
  addPending: (p: {
    schematicFile: string;
    origin: { x: number; y: number; z: number };
    label?: string;
  }) => string;
  removePending: (id: string) => void;
  clearPending: () => void;
}

function genPendingId(): string {
  // Simple ephemeral id — not persisted, never conflicts with server ids.
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useSchematicPlacementStore = create<SchematicPlacementStore>((set, get) => ({
  placement: null,
  placedOrigin: null,

  startPlacement: (placement) => set({ placement, placedOrigin: null }),
  cancelPlacement: () => set({ placement: null, placedOrigin: null }),
  setPlacedOrigin: (origin) => set({ placedOrigin: origin }),

  pending: [],
  addPending: (p) => {
    const id = genPendingId();
    set((state) => ({
      pending: [
        ...state.pending,
        { id, schematicFile: p.schematicFile, origin: p.origin, label: p.label },
      ],
    }));
    return id;
  },
  removePending: (id) =>
    set((state) => ({ pending: state.pending.filter((item) => item.id !== id) })),
  clearPending: () => set({ pending: [] }),
}));

// ─── Mission Store ───

interface MissionStore {
  missions: MissionRecord[];
  setMissions: (missions: MissionRecord[]) => void;
  upsertMission: (mission: MissionRecord) => void;
  removeMission: (id: string) => void;
}

export const useMissionStore = create<MissionStore>((set) => ({
  missions: [],

  setMissions: (missions) => set({ missions }),
  upsertMission: (mission) =>
    set((state) => {
      const idx = state.missions.findIndex((m) => m.id === mission.id);
      if (idx >= 0) {
        const next = [...state.missions];
        next[idx] = mission;
        return { missions: next };
      }
      return { missions: [mission, ...state.missions].slice(0, 200) };
    }),
  removeMission: (id) =>
    set((state) => ({ missions: state.missions.filter((m) => m.id !== id) })),
}));

// ─── Build Store ───

interface BuildStore {
  builds: BuildRecord[];
  setBuilds: (builds: BuildRecord[]) => void;
  upsertBuild: (build: BuildRecord) => void;
}

export const useBuildStore = create<BuildStore>((set) => ({
  builds: [],

  setBuilds: (builds) => set({ builds }),
  upsertBuild: (build) =>
    set((state) => {
      const idx = state.builds.findIndex((b) => b.id === build.id);
      if (idx >= 0) {
        const next = [...state.builds];
        next[idx] = build;
        return { builds: next };
      }
      return { builds: [build, ...state.builds].slice(0, 100) };
    }),
}));

// ─── Campaign Store ───

interface CampaignState {
  campaigns: Campaign[];
  setCampaigns: (campaigns: Campaign[]) => void;
  upsertCampaign: (campaign: Campaign) => void;
  removeCampaign: (id: string) => void;
}

export const useCampaignStore = create<CampaignState>((set) => ({
  campaigns: [],

  setCampaigns: (campaigns) => set({ campaigns }),
  upsertCampaign: (campaign) =>
    set((state) => {
      const idx = state.campaigns.findIndex((c) => c.id === campaign.id);
      if (idx >= 0) {
        const next = [...state.campaigns];
        next[idx] = campaign;
        return { campaigns: next };
      }
      return { campaigns: [campaign, ...state.campaigns] };
    }),
  removeCampaign: (id) =>
    set((state) => ({ campaigns: state.campaigns.filter((c) => c.id !== id) })),
}));

// ─── Chain Store ───

interface ChainStore {
  chains: any[];
  setChains: (chains: any[]) => void;
  upsertChain: (chain: any) => void;
}

export const useChainStore = create<ChainStore>((set) => ({
  chains: [],

  setChains: (chains) => set({ chains }),
  upsertChain: (chain) =>
    set((state) => {
      const idx = state.chains.findIndex((c: any) => c.id === chain.id);
      if (idx >= 0) {
        const next = [...state.chains];
        next[idx] = chain;
        return { chains: next };
      }
      return { chains: [chain, ...state.chains].slice(0, 100) };
    }),
}));
