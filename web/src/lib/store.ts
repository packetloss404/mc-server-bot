'use client';

import { create } from 'zustand';
import type {
  BotStatus, BotEvent, WorldState,
  MarkerRecord, ZoneRecord, RouteRecord,
  SquadRecord, RoleAssignmentRecord,
  BuildJob, SupplyChain, CommandRecord,
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

// Control store for multi-bot selection and fleet operations
interface ControlStore {
  selectedBotIds: Set<string>;
  commandHistory: CommandRecord[];
  toggleBotSelection: (botName: string) => void;
  selectBot: (botName: string) => void;
  deselectBot: (botName: string) => void;
  clearSelection: () => void;
  selectAll: (botNames: string[]) => void;
  upsertCommand: (command: CommandRecord) => void;
}

export const useControlStore = create<ControlStore>((set) => ({
  selectedBotIds: new Set(),
  commandHistory: [],
  toggleBotSelection: (botName) =>
    set((state) => {
      const next = new Set(state.selectedBotIds);
      if (next.has(botName)) next.delete(botName);
      else next.add(botName);
      return { selectedBotIds: next };
    }),
  selectBot: (botName) =>
    set((state) => {
      const next = new Set(state.selectedBotIds);
      next.add(botName);
      return { selectedBotIds: next };
    }),
  deselectBot: (botName) =>
    set((state) => {
      const next = new Set(state.selectedBotIds);
      next.delete(botName);
      return { selectedBotIds: next };
    }),
  clearSelection: () => set({ selectedBotIds: new Set() }),
  selectAll: (botNames) => set({ selectedBotIds: new Set(botNames) }),
  upsertCommand: (command) =>
    set((state) => {
      const idx = state.commandHistory.findIndex((c) => c.id === command.id);
      if (idx >= 0) {
        const next = [...state.commandHistory];
        next[idx] = command;
        return { commandHistory: next };
      }
      return { commandHistory: [command, ...state.commandHistory].slice(0, 100) };
    }),
}));

// Squad store for fleet management (persisted in memory)
export interface Squad {
  id: string;
  name: string;
  botNames: string[];
  createdAt: number;
}

interface FleetStore {
  squads: Squad[];
  selectedSquadId: string | null;
  addSquad: (name: string, botNames: string[]) => Squad;
  removeSquad: (id: string) => void;
  updateSquad: (id: string, patch: Partial<Pick<Squad, 'name' | 'botNames'>>) => void;
  selectSquad: (id: string | null) => void;
  addBotToSquad: (squadId: string, botName: string) => void;
  removeBotFromSquad: (squadId: string, botName: string) => void;
  setSquads: (squads: Squad[]) => void;
  upsertSquad: (squad: Squad) => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const useFleetStore = create<FleetStore>((set, get) => ({
  squads: [],
  selectedSquadId: null,
  addSquad: (name, botNames) => {
    const squad: Squad = { id: generateId(), name, botNames, createdAt: Date.now() };
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

  incrementUnreadChats: () =>
    set((state) => ({ unreadChats: state.unreadChats + 1 })),

  resetUnreadChats: () => set({ unreadChats: 0 }),

  setActiveBuild: (build) => set({ activeBuild: build }),
  setChains: (chains) => set({ chains }),
}));

/* ─── World Planning Store ─── */

interface WorldPlanningStore {
  markers: MarkerRecord[];
  zones: ZoneRecord[];
  routes: RouteRecord[];
  selectedMapObject: { type: 'marker' | 'zone' | 'route'; id: string } | null;
  drawingMode: 'marker' | 'zone' | 'route' | 'add-marker' | null;

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

export const useWorldStore = create<WorldPlanningStore>((set) => ({
  markers: [],
  zones: [],
  routes: [],
  selectedMapObject: null,
  drawingMode: null,

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
}));

/* ─── Fleet Store (SquadRecord-based, merged) ─── */
// Note: The primary useFleetStore is defined above with the Squad interface.
// This section adds SquadRecord-based helpers as a secondary store if needed.

/* ─── Role Store ─── */

interface RoleStore {
  assignments: RoleAssignmentRecord[];
  setAssignments: (assignments: RoleAssignmentRecord[]) => void;
  upsertAssignment: (assignment: RoleAssignmentRecord) => void;
  removeAssignment: (id: string) => void;
}

export const useRoleStore = create<RoleStore>((set) => ({
  assignments: [],
  setAssignments: (assignments) => set({ assignments }),
  upsertAssignment: (assignment) =>
    set((s) => ({ assignments: upsertById(s.assignments, assignment) })),
  removeAssignment: (id) =>
    set((s) => ({ assignments: removeById(s.assignments, id) })),
}));
