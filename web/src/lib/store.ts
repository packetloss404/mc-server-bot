'use client';

import { create } from 'zustand';
import type {
  BotStatus, BotEvent, WorldState,
  MarkerRecord, ZoneRecord, RouteRecord,
  SquadRecord, RoleAssignmentRecord, RoleOverrideRecord, RoleApprovalRecord,
  BuildJob, SupplyChain, CommandRecord, MissionRecord,
  Routine,
  MapOverlayMission, MapOverlayZone, MapOverlaySquad,
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
  activeBuild: BuildJob | null;
  chains: SupplyChain[];

  setBots: (bots: BotStatus[]) => void;
  updatePosition: (bot: string, x: number, y: number, z: number) => void;
  updateHealth: (bot: string, health: number, food: number) => void;
  updateState: (bot: string, state: string) => void;
  updateInventory: (bot: string, items: { name: string; count: number; slot: number }[]) => void;
  pushEvent: (event: BotEvent) => void;
  setConnected: (connected: boolean) => void;
  setWorld: (world: WorldState) => void;
  setPlayers: (players: PlayerData[]) => void;
  setActivityFeed: (events: BotEvent[]) => void;
  updatePlayerPosition: (name: string, x: number, y: number, z: number) => void;
  addPlayer: (name: string) => void;
  removePlayer: (name: string) => void;
  incrementUnreadChats: () => void;
  resetUnreadChats: () => void;
  setActiveBuild: (build: BuildJob | null) => void;
  setChains: (chains: SupplyChain[]) => void;
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

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((i) => i.id === item.id);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = item;
    return next;
  }
  return [...list, item];
}

function removeById<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((i) => i.id !== id);
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ─── Bot Store ───

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
      const updated: Record<string, BotLiveData> = {};
      for (const bot of bots) {
        const key = bot.name.toLowerCase();
        updated[key] = { ...(state.botsById[key] || {}), ...bot } as BotLiveData;
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

  setActivityFeed: (events) =>
    set({
      activityFeed: [...events]
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 200),
    }),

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

  incrementUnreadChats: () =>
    set((state) => ({ unreadChats: state.unreadChats + 1 })),

  resetUnreadChats: () => set({ unreadChats: 0 }),

  setActiveBuild: (build) => set({ activeBuild: build }),
  setChains: (chains) => set({ chains }),
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
  setCommands: (commands) => set({ commandHistory: commands }),
  upsertCommand: (command) =>
    set((state) => {
      const idx = state.commandHistory.findIndex((c) => c.id === command.id);
      if (idx >= 0) {
        const next = [...state.commandHistory];
        next[idx] = { ...next[idx], ...command };
        return { commandHistory: next };
      }
      return {
        commandHistory: [command, ...state.commandHistory].slice(0, 200),
      };
    }),
}));

// ─── Fleet Store (squads) ───

export type Squad = SquadRecord;

interface FleetStore {
  squads: Squad[];
  selectedSquadId: string | null;
  addSquad: (name: string, botNames: string[]) => Squad;
  removeSquad: (id: string) => void;
  updateSquad: (id: string, patch: Partial<Squad>) => void;
  selectSquad: (id: string | null) => void;
  addBotToSquad: (squadId: string, botName: string) => void;
  removeBotFromSquad: (squadId: string, botName: string) => void;
  setSquads: (squads: Squad[]) => void;
  upsertSquad: (squad: Squad) => void;
}

export const useFleetStore = create<FleetStore>((set) => ({
  squads: [],
  selectedSquadId: null,
  addSquad: (name, botNames) => {
    const now = Date.now();
    const squad: Squad = { id: generateId(), name, botNames, createdAt: now, updatedAt: now };
    set((state) => ({ squads: [...state.squads, squad] }));
    return squad;
  },
  removeSquad: (id) =>
    set((state) => ({
      squads: state.squads.filter((s) => s.id !== id),
      selectedSquadId: state.selectedSquadId === id ? null : state.selectedSquadId,
    })),
  updateSquad: (id, patch) =>
    set((state) => ({
      squads: state.squads.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    })),
  selectSquad: (id) => set({ selectedSquadId: id }),
  addBotToSquad: (squadId, botName) =>
    set((state) => ({
      squads: state.squads.map((s) =>
        s.id === squadId && !s.botNames.includes(botName)
          ? { ...s, botNames: [...s.botNames, botName] }
          : s,
      ),
    })),
  removeBotFromSquad: (squadId, botName) =>
    set((state) => ({
      squads: state.squads.map((s) =>
        s.id === squadId ? { ...s, botNames: s.botNames.filter((n) => n !== botName) } : s,
      ),
    })),
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
}));

// ─── World Planning Store (markers, zones, routes) ───

/** Zone geometry in world coordinates (used by map drawing). */
export interface DrawnZone {
  shape: 'rectangle' | 'circle';
  x1?: number;
  z1?: number;
  x2?: number;
  z2?: number;
  cx?: number;
  cz?: number;
  radius?: number;
}

interface WorldPlanningStore {
  markers: MarkerRecord[];
  zones: ZoneRecord[];
  routes: RouteRecord[];
  selectedMapObject: { type: 'marker' | 'zone' | 'route'; id: string } | null;
  drawingMode: 'marker' | 'zone' | 'route' | 'add-marker' | null;
  pendingZone: DrawnZone | null;

  setMarkers: (markers: MarkerRecord[]) => void;
  upsertMarker: (marker: MarkerRecord) => void;
  removeMarker: (id: string) => void;
  setZones: (zones: ZoneRecord[]) => void;
  upsertZone: (zone: ZoneRecord) => void;
  removeZone: (id: string) => void;
  setRoutes: (routes: RouteRecord[]) => void;
  upsertRoute: (route: RouteRecord) => void;
  removeRoute: (id: string) => void;
  setSelectedMapObject: (obj: WorldPlanningStore['selectedMapObject']) => void;
  setDrawingMode: (mode: 'marker' | 'zone' | 'route' | 'add-marker' | 'none' | null) => void;
  setPendingZone: (zone: DrawnZone | null) => void;
}

export const useWorldStore = create<WorldPlanningStore>((set) => ({
  markers: [],
  zones: [],
  routes: [],
  selectedMapObject: null,
  drawingMode: null,
  pendingZone: null,

  setMarkers: (markers) => set({ markers }),
  upsertMarker: (marker) => set((s) => ({ markers: upsertById(s.markers, marker) })),
  removeMarker: (id) => set((s) => ({ markers: removeById(s.markers, id) })),

  setZones: (zones) => set({ zones }),
  upsertZone: (zone) => set((s) => ({ zones: upsertById(s.zones, zone) })),
  removeZone: (id) => set((s) => ({ zones: removeById(s.zones, id) })),

  setRoutes: (routes) => set({ routes }),
  upsertRoute: (route) => set((s) => ({ routes: upsertById(s.routes, route) })),
  removeRoute: (id) => set((s) => ({ routes: removeById(s.routes, id) })),

  setSelectedMapObject: (obj) => set({ selectedMapObject: obj }),
  setDrawingMode: (mode) => set({ drawingMode: mode === 'none' ? null : mode }),
  setPendingZone: (zone) => set({ pendingZone: zone }),
}));

// ─── Routine Store ───

interface RoutineStore {
  routines: Routine[];
  recording: boolean;
  draft: Routine | null;

  setRoutines: (routines: Routine[]) => void;
  addRoutine: (routine: Routine) => void;
  updateRoutine: (routine: Routine) => void;
  removeRoutine: (id: string) => void;
  setRecording: (recording: boolean, draft: Routine | null) => void;
}

export const useRoutineStore = create<RoutineStore>((set) => ({
  routines: [],
  recording: false,
  draft: null,

  setRoutines: (routines) => set({ routines }),

  addRoutine: (routine) =>
    set((state) => ({ routines: [...state.routines, routine] })),

  updateRoutine: (routine) =>
    set((state) => ({
      routines: state.routines.map((r) => (r.id === routine.id ? routine : r)),
    })),

  removeRoutine: (id) =>
    set((state) => ({
      routines: state.routines.filter((r) => r.id !== id),
    })),

  setRecording: (recording, draft) => set({ recording, draft }),
}));

// ─── Role Store (role assignments, overrides, approvals) ───

interface RoleStore {
  assignments: RoleAssignmentRecord[];
  overrides: Record<string, RoleOverrideRecord>;
  approvals: RoleApprovalRecord[];
  missions: MissionRecord[];
  setAssignments: (assignments: RoleAssignmentRecord[]) => void;
  setOverrides: (overrides: Record<string, RoleOverrideRecord>) => void;
  setApprovals: (approvals: RoleApprovalRecord[]) => void;
  setMissions: (missions: MissionRecord[]) => void;
  upsertAssignment: (assignment: RoleAssignmentRecord) => void;
  removeAssignment: (id: string) => void;
  getOverrideForBot: (botName: string) => RoleOverrideRecord | undefined;
  getBlockedMissionForBot: (botName: string) => MissionRecord | undefined;
}

export const useRoleStore = create<RoleStore>((set, get) => ({
  assignments: [],
  overrides: {},
  approvals: [],
  missions: [],

  setAssignments: (assignments) => set({ assignments }),
  setOverrides: (overrides) => set({ overrides }),
  setApprovals: (approvals) => set({ approvals }),
  setMissions: (missions) => set({ missions }),
  upsertAssignment: (assignment) =>
    set((s) => ({ assignments: upsertById(s.assignments, assignment) })),
  removeAssignment: (id) =>
    set((s) => ({ assignments: removeById(s.assignments, id) })),

  getOverrideForBot: (botName: string) => {
    const key = botName.toLowerCase();
    const overrides = get().overrides;
    return overrides[botName] ?? overrides[key] ??
      Object.values(overrides).find((o) => o.reason?.toLowerCase().includes(key));
  },

  getBlockedMissionForBot: (botName: string) => {
    const key = botName.toLowerCase();
    return get().missions.find(
      (m) => m.status === 'running' && m.blockedReason &&
        m.assigneeIds.some((id) => id.toLowerCase() === key)
    );
  },
}));

// ─── Mission Store ───

interface MissionStore {
  missions: MissionRecord[];
  setMissions: (missions: MissionRecord[]) => void;
  upsertMission: (mission: MissionRecord) => void;
  removeMission: (id: string) => void;
  getRunningForBot: (botName: string) => MissionRecord[];
}

export const useMissionStore = create<MissionStore>((set, get) => ({
  missions: [],
  setMissions: (missions) =>
    set({
      missions: [...missions].sort((a, b) => b.updatedAt - a.updatedAt),
    }),
  upsertMission: (mission) =>
    set((state) => {
      const idx = state.missions.findIndex((m) => m.id === mission.id);
      if (idx >= 0) {
        const next = [...state.missions];
        next[idx] = { ...next[idx], ...mission };
        next.sort((a, b) => b.updatedAt - a.updatedAt);
        return { missions: next };
      }
      return {
        missions: [...state.missions, mission].sort((a, b) => b.updatedAt - a.updatedAt),
      };
    }),
  removeMission: (id) =>
    set((state) => ({ missions: state.missions.filter((mission) => mission.id !== id) })),
  getRunningForBot: (botName) => {
    const lower = botName.toLowerCase();
    return get().missions.filter(
      (mission) =>
        mission.status === 'running' &&
        mission.assigneeIds.some((id) => id.toLowerCase() === lower),
    );
  },
}));

// ─── Build Store ───

interface BuildStore {
  builds: BuildJob[];
  upsertBuild: (build: BuildJob) => void;
  setBuilds: (builds: BuildJob[]) => void;
}

export const useBuildStore = create<BuildStore>((set) => ({
  builds: [],

  upsertBuild: (build) =>
    set((state) => {
      const idx = state.builds.findIndex((b) => b.id === build.id);
      if (idx >= 0) {
        const updated = [...state.builds];
        updated[idx] = build;
        return { builds: updated };
      }
      return { builds: [build, ...state.builds].slice(0, 100) };
    }),

  setBuilds: (builds) => set({ builds }),
}));

// ─── Supply Chain Store ───

interface ChainStore {
  chains: SupplyChain[];
  upsertChain: (chain: SupplyChain) => void;
  setChains: (chains: SupplyChain[]) => void;
}

export const useChainStore = create<ChainStore>((set) => ({
  chains: [],

  upsertChain: (chain) =>
    set((state) => {
      const idx = state.chains.findIndex((c) => c.id === chain.id);
      if (idx >= 0) {
        const updated = [...state.chains];
        updated[idx] = chain;
        return { chains: updated };
      }
      return { chains: [chain, ...state.chains].slice(0, 100) };
    }),

  setChains: (chains) => set({ chains }),
}));

// ─── Schematic Placement Store ───

interface SchematicPlacementStore {
  activeSchematic: { filename: string; sizeX: number; sizeZ: number; sizeY: number } | null;
  placedOrigin: { x: number; y: number; z: number } | null;
  cursorWorldPos: { x: number; z: number } | null;
  startPlacement: (schematic: { filename: string; sizeX: number; sizeZ: number; sizeY: number }) => void;
  setPlacedOrigin: (origin: { x: number; y: number; z: number }) => void;
  setCursorWorldPos: (pos: { x: number; z: number } | null) => void;
  cancelPlacement: () => void;
}

export const useSchematicPlacementStore = create<SchematicPlacementStore>((set) => ({
  activeSchematic: null,
  placedOrigin: null,
  cursorWorldPos: null,
  startPlacement: (schematic) => set({ activeSchematic: schematic, placedOrigin: null, cursorWorldPos: null }),
  setPlacedOrigin: (origin) => set({ placedOrigin: origin }),
  setCursorWorldPos: (pos) => set({ cursorWorldPos: pos }),
  cancelPlacement: () => set({ activeSchematic: null, placedOrigin: null, cursorWorldPos: null }),
}));

// ─── Map Overlay Store (missions, zones, squads for map rendering) ───

interface MapOverlayStore {
  missions: MapOverlayMission[];
  zones: MapOverlayZone[];
  squads: MapOverlaySquad[];
  setMissions: (missions: MapOverlayMission[]) => void;
  setZones: (zones: MapOverlayZone[]) => void;
  setSquads: (squads: MapOverlaySquad[]) => void;
}

export const useMapOverlayStore = create<MapOverlayStore>((set) => ({
  missions: [],
  zones: [],
  squads: [],
  setMissions: (missions) => set({ missions }),
  setZones: (zones) => set({ zones }),
  setSquads: (squads) => set({ squads }),
}));
