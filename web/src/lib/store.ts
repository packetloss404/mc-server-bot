'use client';

import { create } from 'zustand';
import type {
  BotStatus, BotEvent, WorldState,
  SquadRecord, RoleAssignmentRecord, RoleOverrideRecord, RoleApprovalRecord,
  CommandRecord, MissionRecord,
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
}));
