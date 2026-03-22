'use client';

import { create } from 'zustand';
import type { BotStatus, BotEvent, WorldState, BuildJob, SupplyChain } from './api';

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
  activeBuild: BuildJob | null;
  setActiveBuild: (build: BuildJob | null) => void;
  updateBuildProgress: (buildId: string, botName: string, blocksPlaced: number, currentY: number) => void;
  updateBuildBotStatus: (buildId: string, botName: string, status: string) => void;
  chains: SupplyChain[];
  setChains: (chains: SupplyChain[]) => void;
  updateChainStage: (chainId: string, stageIndex: number, stage: any) => void;
  updateChainStatus: (chainId: string, status: string) => void;
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

  activeBuild: null,

  setActiveBuild: (build) => set({ activeBuild: build }),

  updateBuildProgress: (buildId, botName, blocksPlaced, currentY) =>
    set((state) => {
      if (!state.activeBuild || state.activeBuild.id !== buildId || !state.activeBuild.assignments) return {};
      const assignments = state.activeBuild.assignments.map((a) =>
        a.botName === botName ? { ...a, blocksPlaced, currentY } : a,
      );
      const totalPlaced = assignments.reduce((sum, a) => sum + a.blocksPlaced, 0);
      return {
        activeBuild: { ...state.activeBuild, assignments, placedBlocks: totalPlaced },
      };
    }),

  updateBuildBotStatus: (buildId, botName, status) =>
    set((state) => {
      if (!state.activeBuild || state.activeBuild.id !== buildId || !state.activeBuild.assignments) return {};
      const assignments = state.activeBuild.assignments.map((a) =>
        a.botName === botName ? { ...a, status: status as any } : a,
      );
      return {
        activeBuild: { ...state.activeBuild, assignments },
      };
    }),

  chains: [],

  setChains: (chains) => set({ chains }),

  updateChainStage: (chainId, stageIndex, stage) =>
    set((state) => ({
      chains: state.chains.map((c) =>
        c.id === chainId
          ? { ...c, stages: c.stages.map((s, i) => (i === stageIndex ? { ...s, ...stage } : s)), currentStageIndex: stageIndex }
          : c,
      ),
    })),

  updateChainStatus: (chainId, status) =>
    set((state) => ({
      chains: state.chains.map((c) =>
        c.id === chainId ? { ...c, status: status as any } : c,
      ),
    })),
}));
