'use client';

import { create } from 'zustand';

export interface Squad {
  id: string;
  name: string;
  memberNames: string[];
  createdAt: number;
}

export type CommandStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface BotCommandState {
  botName: string;
  command: string;
  status: CommandStatus;
  startedAt: number;
  finishedAt?: number;
  error?: string;
}

interface ControlStore {
  // Selection
  selectedBotIds: Set<string>;
  toggleBotSelection: (name: string) => void;
  selectBots: (names: string[]) => void;
  clearSelection: () => void;
  isSelected: (name: string) => boolean;

  // Squads
  squads: Squad[];
  createSquad: (name: string, memberNames: string[]) => string;
  deleteSquad: (id: string) => void;
  renameSquad: (id: string, name: string) => void;
  updateSquadMembers: (id: string, memberNames: string[]) => void;
  activeSquadId: string | null;
  setActiveSquad: (id: string | null) => void;

  // Command tracking
  commandStates: Record<string, BotCommandState>;
  setCommandState: (botName: string, state: BotCommandState) => void;
  clearCommandState: (botName: string) => void;
  clearAllCommandStates: () => void;
}

let squadCounter = 0;

export const useControlStore = create<ControlStore>((set, get) => ({
  // Selection
  selectedBotIds: new Set<string>(),

  toggleBotSelection: (name: string) =>
    set((state) => {
      const next = new Set(state.selectedBotIds);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return { selectedBotIds: next };
    }),

  selectBots: (names: string[]) =>
    set({ selectedBotIds: new Set(names) }),

  clearSelection: () =>
    set({ selectedBotIds: new Set<string>() }),

  isSelected: (name: string) => get().selectedBotIds.has(name),

  // Squads
  squads: [],
  activeSquadId: null,

  createSquad: (name: string, memberNames: string[]) => {
    const id = `squad-${++squadCounter}-${Date.now()}`;
    set((state) => ({
      squads: [...state.squads, { id, name, memberNames, createdAt: Date.now() }],
      activeSquadId: id,
    }));
    return id;
  },

  deleteSquad: (id: string) =>
    set((state) => ({
      squads: state.squads.filter((s) => s.id !== id),
      activeSquadId: state.activeSquadId === id ? null : state.activeSquadId,
    })),

  renameSquad: (id: string, name: string) =>
    set((state) => ({
      squads: state.squads.map((s) => (s.id === id ? { ...s, name } : s)),
    })),

  updateSquadMembers: (id: string, memberNames: string[]) =>
    set((state) => ({
      squads: state.squads.map((s) => (s.id === id ? { ...s, memberNames } : s)),
    })),

  setActiveSquad: (id: string | null) => set({ activeSquadId: id }),

  // Command tracking
  commandStates: {},

  setCommandState: (botName: string, state: BotCommandState) =>
    set((prev) => ({
      commandStates: { ...prev.commandStates, [botName]: state },
    })),

  clearCommandState: (botName: string) =>
    set((prev) => {
      const next = { ...prev.commandStates };
      delete next[botName];
      return { commandStates: next };
    }),

  clearAllCommandStates: () => set({ commandStates: {} }),
}));
