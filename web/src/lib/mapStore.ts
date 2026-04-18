'use client';

import { create } from 'zustand';
import type { Marker, Zone, Route, Mission, Squad } from './api';

// Drawing tool modes
export type MapTool = 'select' | 'draw-zone' | 'draw-route' | 'place-marker' | 'place-building';

interface MapOverlayStore {
  // World data
  markers: Marker[];
  zones: Zone[];
  routes: Route[];
  missions: Mission[];
  squads: Squad[];

  // Tool state
  activeTool: MapTool;
  setActiveTool: (tool: MapTool) => void;

  // Zone drawing state
  zoneDrawStart: { x: number; z: number } | null;
  zoneDrawEnd: { x: number; z: number } | null;
  setZoneDrawStart: (pt: { x: number; z: number } | null) => void;
  setZoneDrawEnd: (pt: { x: number; z: number } | null) => void;

  // Route drawing state
  routeWaypoints: { x: number; y: number; z: number }[];
  addRouteWaypoint: (pt: { x: number; y: number; z: number }) => void;
  clearRouteWaypoints: () => void;

  // Dialog state
  showZoneDialog: boolean;
  zoneDialogCoords: { x1: number; z1: number; x2: number; z2: number } | null;
  openZoneDialog: (coords: { x1: number; z1: number; x2: number; z2: number }) => void;
  closeZoneDialog: () => void;

  showRouteDialog: boolean;
  openRouteDialog: () => void;
  closeRouteDialog: () => void;

  // Context menu
  contextMenu: { screenX: number; screenY: number; worldX: number; worldZ: number } | null;
  openContextMenu: (data: { screenX: number; screenY: number; worldX: number; worldZ: number }) => void;
  closeContextMenu: () => void;

  // Data setters
  setMarkers: (markers: Marker[]) => void;
  setZones: (zones: Zone[]) => void;
  setRoutes: (routes: Route[]) => void;
  setMissions: (missions: Mission[]) => void;
  setSquads: (squads: Squad[]) => void;
  addMarker: (m: Marker) => void;
  addZone: (z: Zone) => void;
  addRoute: (r: Route) => void;
  removeMarker: (id: string) => void;
  removeZone: (id: string) => void;
  removeRoute: (id: string) => void;
}

export const useMapOverlayStore = create<MapOverlayStore>((set) => ({
  markers: [],
  zones: [],
  routes: [],
  missions: [],
  squads: [],

  activeTool: 'select',
  setActiveTool: (tool) => set({ activeTool: tool }),

  zoneDrawStart: null,
  zoneDrawEnd: null,
  setZoneDrawStart: (pt) => set({ zoneDrawStart: pt }),
  setZoneDrawEnd: (pt) => set({ zoneDrawEnd: pt }),

  routeWaypoints: [],
  addRouteWaypoint: (pt) => set((s) => ({ routeWaypoints: [...s.routeWaypoints, pt] })),
  clearRouteWaypoints: () => set({ routeWaypoints: [] }),

  showZoneDialog: false,
  zoneDialogCoords: null,
  openZoneDialog: (coords) => set({ showZoneDialog: true, zoneDialogCoords: coords }),
  closeZoneDialog: () => set({ showZoneDialog: false, zoneDialogCoords: null, zoneDrawStart: null, zoneDrawEnd: null }),

  showRouteDialog: false,
  openRouteDialog: () => set({ showRouteDialog: true }),
  closeRouteDialog: () => set({ showRouteDialog: false }),

  contextMenu: null,
  openContextMenu: (data) => set({ contextMenu: data }),
  closeContextMenu: () => set({ contextMenu: null }),

  setMarkers: (markers) => set({ markers }),
  setZones: (zones) => set({ zones }),
  setRoutes: (routes) => set({ routes }),
  setMissions: (missions) => set({ missions }),
  setSquads: (squads) => set({ squads }),
  addMarker: (m) => set((s) => ({ markers: [...s.markers, m] })),
  addZone: (z) => set((s) => ({ zones: [...s.zones, z] })),
  addRoute: (r) => set((s) => ({ routes: [...s.routes, r] })),
  removeMarker: (id) => set((s) => ({ markers: s.markers.filter((m) => m.id !== id) })),
  removeZone: (id) => set((s) => ({ zones: s.zones.filter((z) => z.id !== id) })),
  removeRoute: (id) => set((s) => ({ routes: s.routes.filter((r) => r.id !== id) })),
}));
