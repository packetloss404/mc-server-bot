'use client';

import { create } from 'zustand';
import type { Zone, Marker, Route, Mission } from './api';
import { api } from './api';

interface ControlStore {
  // Selection
  selectedBotIds: string[];
  toggleBotSelection: (name: string) => void;
  setSelectedBots: (names: string[]) => void;
  clearSelection: () => void;

  // Zones
  zones: Zone[];
  setZones: (zones: Zone[]) => void;
  fetchZones: () => Promise<void>;

  // Markers
  markers: Marker[];
  setMarkers: (markers: Marker[]) => void;
  fetchMarkers: () => Promise<void>;

  // Routes
  routes: Route[];
  setRoutes: (routes: Route[]) => void;
  fetchRoutes: () => Promise<void>;

  // Missions
  missions: Mission[];
  setMissions: (missions: Mission[]) => void;
  fetchMissions: () => Promise<void>;

  // Loading state
  loaded: boolean;
  fetchAll: () => Promise<void>;
}

export const useControlStore = create<ControlStore>((set, get) => ({
  selectedBotIds: [],
  toggleBotSelection: (name) =>
    set((s) => ({
      selectedBotIds: s.selectedBotIds.includes(name)
        ? s.selectedBotIds.filter((n) => n !== name)
        : [...s.selectedBotIds, name],
    })),
  setSelectedBots: (names) => set({ selectedBotIds: names }),
  clearSelection: () => set({ selectedBotIds: [] }),

  zones: [],
  setZones: (zones) => set({ zones }),
  fetchZones: async () => {
    try {
      const { zones } = await api.getZones();
      set({ zones });
    } catch { /* ignore */ }
  },

  markers: [],
  setMarkers: (markers) => set({ markers }),
  fetchMarkers: async () => {
    try {
      const { markers } = await api.getMarkers();
      set({ markers });
    } catch { /* ignore */ }
  },

  routes: [],
  setRoutes: (routes) => set({ routes }),
  fetchRoutes: async () => {
    try {
      const { routes } = await api.getRoutes();
      set({ routes });
    } catch { /* ignore */ }
  },

  missions: [],
  setMissions: (missions) => set({ missions }),
  fetchMissions: async () => {
    try {
      const { missions } = await api.getMissions();
      set({ missions });
    } catch { /* ignore */ }
  },

  loaded: false,
  fetchAll: async () => {
    const store = get();
    await Promise.allSettled([
      store.fetchZones(),
      store.fetchMarkers(),
      store.fetchRoutes(),
      store.fetchMissions(),
    ]);
    set({ loaded: true });
  },
}));
