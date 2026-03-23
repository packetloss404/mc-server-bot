'use client';

import { create } from 'zustand';

export interface MapMarker {
  id: string;
  name: string;
  kind: 'base' | 'storage' | 'build-site' | 'mine' | 'village' | 'custom';
  position: { x: number; y: number; z: number };
  tags: string[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

export type ZoneMode = 'guard' | 'avoid' | 'farm' | 'build' | 'gather' | 'custom';

export interface MapZone {
  id: string;
  name: string;
  mode: ZoneMode;
  rect: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export interface ActiveBuild {
  schematicName: string;
  origin: { x: number; y: number; z: number };
  dimensions: { width: number; height: number; depth: number };
  progress?: number;
}

export type MapInteractionMode = 'pan' | 'marker' | 'zone';

interface MapStore {
  markers: MapMarker[];
  zones: MapZone[];
  activeBuild: ActiveBuild | null;
  interactionMode: MapInteractionMode;
  editingMarkerId: string | null;
  editingZoneId: string | null;

  setMarkers: (markers: MapMarker[]) => void;
  addMarker: (marker: MapMarker) => void;
  updateMarker: (id: string, patch: Partial<MapMarker>) => void;
  removeMarker: (id: string) => void;
  setZones: (zones: MapZone[]) => void;
  addZone: (zone: MapZone) => void;
  updateZone: (id: string, patch: Partial<MapZone>) => void;
  removeZone: (id: string) => void;
  setActiveBuild: (build: ActiveBuild | null) => void;
  setInteractionMode: (mode: MapInteractionMode) => void;
  setEditingMarkerId: (id: string | null) => void;
  setEditingZoneId: (id: string | null) => void;
}

let _nextId = 1;
export function generateId(): string {
  return `map_${Date.now()}_${_nextId++}`;
}

export const useMapStore = create<MapStore>((set) => ({
  markers: [],
  zones: [],
  activeBuild: null,
  interactionMode: 'pan',
  editingMarkerId: null,
  editingZoneId: null,

  setMarkers: (markers) => set({ markers }),
  addMarker: (marker) =>
    set((state) => ({ markers: [...state.markers, marker] })),
  updateMarker: (id, patch) =>
    set((state) => ({
      markers: state.markers.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  removeMarker: (id) =>
    set((state) => ({ markers: state.markers.filter((m) => m.id !== id) })),
  setZones: (zones) => set({ zones }),
  addZone: (zone) =>
    set((state) => ({ zones: [...state.zones, zone] })),
  updateZone: (id, patch) =>
    set((state) => ({
      zones: state.zones.map((z) => (z.id === id ? { ...z, ...patch } : z)),
    })),
  removeZone: (id) =>
    set((state) => ({ zones: state.zones.filter((z) => z.id !== id) })),
  setActiveBuild: (build) => set({ activeBuild: build }),
  setInteractionMode: (mode) => set({ interactionMode: mode }),
  setEditingMarkerId: (id) => set({ editingMarkerId: id }),
  setEditingZoneId: (id) => set({ editingZoneId: id }),
}));
