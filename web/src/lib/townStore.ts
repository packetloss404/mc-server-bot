'use client';

import { create } from 'zustand';

// ─── Town shapes (mirrors the published Phase 1 API contract). Tightened
//     once the backend lands; the keys here match section 12 of the spec. ─

export type StylePreset = 'medieval-communal' | 'mid-century-civic';
export type TownTier = 'founding' | 'village' | 'town';
export type TownStatus = 'active' | 'dormant' | 'abandoned';
export type Alliance = 'allied' | 'rival' | 'neutral' | null;

export interface Town {
  id: string;
  name: string;
  foundedAt: number;
  capital: { x: number; y: number; z: number };
  tier: TownTier;
  status: TownStatus;
  population: number;
  alliance: Alliance;
  parentTownId?: string | null;
  styleSeed: StylePreset;
  mayorTitle?: string | null;
  /** Phase 6-A — the player who founded the town; used by the Mayor panel. */
  mayorPlayerName?: string | null;
  /**
   * When the Town Brain is paused, bots stay alive but stop proactively
   * acting. Default false. Synced from the API response (status === 'paused'
   * or an explicit `paused: true` on the town payload).
   */
  paused: boolean;
}

export interface District {
  id: string;
  townId: string;
  name: string;
  stylePreset: StylePreset;
  isDefault: boolean;
}

export interface Building {
  id: string;
  townId: string;
  districtId?: string | null;
  name: string;
  status: 'planned' | 'building' | 'complete' | 'damaged' | 'destroyed';
  origin?: { x: number; y: number; z: number };
}

export interface Resident {
  id: string;
  townId: string;
  botName: string;
  joinedAt: number;
  currentRole?: string | null;
  status: 'alive' | 'dead' | 'departed';
}

export interface TownEvent {
  id: string;
  townId: string;
  kind: string;
  severity: string;
  payload: unknown;
  occurredAt: number;
  highlightScore: number;
}

// ─── Store ────────────────────────────────────────────────────────────────

interface TownStore {
  towns: Town[];
  /** ID of the active town in the picker. Null = no town selected (or none exists). */
  activeTownId: string | null;

  setTowns: (towns: Town[]) => void;
  upsertTown: (town: Town) => void;
  removeTown: (id: string) => void;
  selectTown: (id: string | null) => void;
  /** Flip the `paused` flag on a single town without a full refetch. */
  setTownPaused: (id: string, paused: boolean) => void;
}

export const useTownStore = create<TownStore>((set) => ({
  towns: [],
  activeTownId: null,

  setTowns: (towns) =>
    set((state) => {
      // If the currently active town vanished from the list, deselect.
      // Otherwise, if nothing is selected yet, pick the first one for convenience.
      let activeTownId = state.activeTownId;
      if (activeTownId && !towns.some((t) => t.id === activeTownId)) {
        activeTownId = null;
      }
      if (!activeTownId && towns.length > 0) {
        activeTownId = towns[0].id;
      }
      return { towns, activeTownId };
    }),

  upsertTown: (town) =>
    set((state) => {
      const idx = state.towns.findIndex((t) => t.id === town.id);
      if (idx >= 0) {
        const next = [...state.towns];
        next[idx] = town;
        return { towns: next };
      }
      return { towns: [...state.towns, town] };
    }),

  removeTown: (id) =>
    set((state) => ({
      towns: state.towns.filter((t) => t.id !== id),
      activeTownId: state.activeTownId === id ? null : state.activeTownId,
    })),

  selectTown: (id) => set({ activeTownId: id }),

  setTownPaused: (id, paused) =>
    set((state) => ({
      towns: state.towns.map((t) => (t.id === id ? { ...t, paused } : t)),
    })),
}));
