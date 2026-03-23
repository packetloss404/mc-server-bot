'use client';

import { create } from 'zustand';
import type {
  BotStatus, BotEvent, WorldState,
  MarkerRecord, ZoneRecord, RouteRecord,
  SquadRecord, RoleAssignmentRecord,
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
}));

/* ─── World Planning Store ─── */

interface WorldPlanningStore {
  markers: MarkerRecord[];
  zones: ZoneRecord[];
  routes: RouteRecord[];
  selectedMapObject: { type: 'marker' | 'zone' | 'route'; id: string } | null;
  drawingMode: 'marker' | 'zone' | 'route' | null;

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
  setDrawingMode: (mode: WorldPlanningStore['drawingMode']) => void;
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
  setDrawingMode: (mode) => set({ drawingMode: mode }),
}));

/* ─── Fleet Store ─── */

interface FleetStore {
  squads: SquadRecord[];
  setSquads: (squads: SquadRecord[]) => void;
  upsertSquad: (squad: SquadRecord) => void;
  removeSquad: (id: string) => void;
}

export const useFleetStore = create<FleetStore>((set) => ({
  squads: [],
  setSquads: (squads) => set({ squads }),
  upsertSquad: (squad) => set((s) => ({ squads: upsertById(s.squads, squad) })),
  removeSquad: (id) => set((s) => ({ squads: removeById(s.squads, id) })),
}));

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
