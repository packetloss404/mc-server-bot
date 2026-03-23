'use client';

import { create } from 'zustand';
import type { BotStatus, BotEvent, WorldState, CommandRecord, MissionRecord } from './api';

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

// ---------------------------------------------------------------------------
// Control Store – commands & bot selection
// ---------------------------------------------------------------------------

interface ControlStore {
  // Commands
  commandsById: Record<string, CommandRecord>;
  commandHistory: CommandRecord[];
  pendingCommands: CommandRecord[];

  // Selection
  selectedBotIds: Set<string>;

  // Actions
  upsertCommand: (command: CommandRecord) => void;
  addCommandToHistory: (command: CommandRecord) => void;
  setSelectedBotIds: (ids: Set<string>) => void;
  toggleBotSelection: (id: string) => void;
  clearSelection: () => void;
}

export const useControlStore = create<ControlStore>((set) => ({
  commandsById: {},
  commandHistory: [],
  pendingCommands: [],
  selectedBotIds: new Set<string>(),

  upsertCommand: (command) =>
    set((state) => {
      const updated = { ...state.commandsById, [command.id]: command };
      const pending = Object.values(updated).filter(
        (c) => c.status === 'queued' || c.status === 'started',
      );
      const history = Object.values(updated)
        .filter((c) => c.status !== 'queued' && c.status !== 'started')
        .sort((a, b) => (b.completedAt || b.createdAt) - (a.completedAt || a.createdAt))
        .slice(0, 100);
      return { commandsById: updated, pendingCommands: pending, commandHistory: history };
    }),

  addCommandToHistory: (command) =>
    set((state) => ({
      commandHistory: [command, ...state.commandHistory].slice(0, 100),
    })),

  setSelectedBotIds: (ids) => set({ selectedBotIds: ids }),

  toggleBotSelection: (id) =>
    set((state) => {
      const next = new Set(state.selectedBotIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selectedBotIds: next };
    }),

  clearSelection: () => set({ selectedBotIds: new Set<string>() }),
}));

// ---------------------------------------------------------------------------
// Mission Store
// ---------------------------------------------------------------------------

interface MissionStore {
  missionsById: Record<string, MissionRecord>;
  missionList: MissionRecord[];

  upsertMission: (mission: MissionRecord) => void;
  removeMission: (id: string) => void;
  setMissions: (missions: MissionRecord[]) => void;
}

export const useMissionStore = create<MissionStore>((set) => ({
  missionsById: {},
  missionList: [],

  upsertMission: (mission) =>
    set((state) => {
      const updated = { ...state.missionsById, [mission.id]: mission };
      return {
        missionsById: updated,
        missionList: Object.values(updated).sort((a, b) => b.updatedAt - a.updatedAt),
      };
    }),

  removeMission: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.missionsById;
      return {
        missionsById: rest,
        missionList: Object.values(rest).sort((a, b) => b.updatedAt - a.updatedAt),
      };
    }),

  setMissions: (missions) => {
    const byId: Record<string, MissionRecord> = {};
    for (const m of missions) byId[m.id] = m;
    return set({
      missionsById: byId,
      missionList: [...missions].sort((a, b) => b.updatedAt - a.updatedAt),
    });
  },
}));
