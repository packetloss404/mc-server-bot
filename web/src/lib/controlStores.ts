'use client';

import { create } from 'zustand';

// ═══════════════════════════════════════
//  Command types & store
// ═══════════════════════════════════════

export interface CommandRecord {
  id: string;
  type: string;
  botName: string;
  status: 'queued' | 'started' | 'succeeded' | 'failed' | 'cancelled';
  params?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

interface ControlStore {
  commandHistory: CommandRecord[];
  upsertCommand: (cmd: CommandRecord) => void;
  setCommands: (cmds: CommandRecord[]) => void;
}

export const useControlStore = create<ControlStore>((set) => ({
  commandHistory: [],

  upsertCommand: (cmd) =>
    set((state) => {
      const idx = state.commandHistory.findIndex((c) => c.id === cmd.id);
      if (idx >= 0) {
        const updated = [...state.commandHistory];
        updated[idx] = cmd;
        return { commandHistory: updated };
      }
      return { commandHistory: [cmd, ...state.commandHistory].slice(0, 200) };
    }),

  setCommands: (cmds) => set({ commandHistory: cmds }),
}));

// ═══════════════════════════════════════
//  Mission types & store
// ═══════════════════════════════════════

export interface MissionRecord {
  id: string;
  type: string;
  botName: string;
  status: string;
  description?: string;
  priority?: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  progress?: number;
  metadata?: Record<string, any>;
}

interface MissionStore {
  missions: MissionRecord[];
  upsertMission: (mission: MissionRecord) => void;
  setMissions: (missions: MissionRecord[]) => void;
  removeMission: (id: string) => void;
}

export const useMissionStore = create<MissionStore>((set) => ({
  missions: [],

  upsertMission: (mission) =>
    set((state) => {
      const idx = state.missions.findIndex((m) => m.id === mission.id);
      if (idx >= 0) {
        const updated = [...state.missions];
        updated[idx] = mission;
        return { missions: updated };
      }
      return { missions: [mission, ...state.missions].slice(0, 200) };
    }),

  setMissions: (missions) => set({ missions }),

  removeMission: (id) =>
    set((state) => ({
      missions: state.missions.filter((m) => m.id !== id),
    })),
}));

// ═══════════════════════════════════════
//  World markers, zones, routes store
// ═══════════════════════════════════════

export interface Marker {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  type?: string;
  metadata?: Record<string, any>;
}

export interface Zone {
  id: string;
  name: string;
  type: string;
  bounds: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface Route {
  id: string;
  name: string;
  waypoints: { x: number; y: number; z: number }[];
  metadata?: Record<string, any>;
}

interface WorldStore {
  markers: Marker[];
  zones: Zone[];
  routes: Route[];
  upsertMarker: (marker: Marker) => void;
  setMarkers: (markers: Marker[]) => void;
  removeMarker: (id: string) => void;
  upsertZone: (zone: Zone) => void;
  setZones: (zones: Zone[]) => void;
  removeZone: (id: string) => void;
  upsertRoute: (route: Route) => void;
  setRoutes: (routes: Route[]) => void;
  removeRoute: (id: string) => void;
}

export const useWorldStore = create<WorldStore>((set) => ({
  markers: [],
  zones: [],
  routes: [],

  upsertMarker: (marker) =>
    set((state) => {
      const idx = state.markers.findIndex((m) => m.id === marker.id);
      if (idx >= 0) {
        const updated = [...state.markers];
        updated[idx] = marker;
        return { markers: updated };
      }
      return { markers: [...state.markers, marker] };
    }),

  setMarkers: (markers) => set({ markers }),

  removeMarker: (id) =>
    set((state) => ({ markers: state.markers.filter((m) => m.id !== id) })),

  upsertZone: (zone) =>
    set((state) => {
      const idx = state.zones.findIndex((z) => z.id === zone.id);
      if (idx >= 0) {
        const updated = [...state.zones];
        updated[idx] = zone;
        return { zones: updated };
      }
      return { zones: [...state.zones, zone] };
    }),

  setZones: (zones) => set({ zones }),

  removeZone: (id) =>
    set((state) => ({ zones: state.zones.filter((z) => z.id !== id) })),

  upsertRoute: (route) =>
    set((state) => {
      const idx = state.routes.findIndex((r) => r.id === route.id);
      if (idx >= 0) {
        const updated = [...state.routes];
        updated[idx] = route;
        return { routes: updated };
      }
      return { routes: [...state.routes, route] };
    }),

  setRoutes: (routes) => set({ routes }),

  removeRoute: (id) =>
    set((state) => ({ routes: state.routes.filter((r) => r.id !== id) })),
}));

// ═══════════════════════════════════════
//  Fleet (squads) store
// ═══════════════════════════════════════

export interface Squad {
  id: string;
  name: string;
  members: string[];
  metadata?: Record<string, any>;
}

interface FleetStore {
  squads: Squad[];
  upsertSquad: (squad: Squad) => void;
  setSquads: (squads: Squad[]) => void;
  removeSquad: (id: string) => void;
}

export const useFleetStore = create<FleetStore>((set) => ({
  squads: [],

  upsertSquad: (squad) =>
    set((state) => {
      const idx = state.squads.findIndex((s) => s.id === squad.id);
      if (idx >= 0) {
        const updated = [...state.squads];
        updated[idx] = squad;
        return { squads: updated };
      }
      return { squads: [...state.squads, squad] };
    }),

  setSquads: (squads) => set({ squads }),

  removeSquad: (id) =>
    set((state) => ({ squads: state.squads.filter((s) => s.id !== id) })),
}));

// ═══════════════════════════════════════
//  Role assignments store
// ═══════════════════════════════════════

export interface RoleAssignment {
  id: string;
  botName: string;
  role: string;
  autonomyLevel?: string;
  manualOverride?: boolean;
  overrideExpiresAt?: number;
  metadata?: Record<string, any>;
}

interface RoleStore {
  assignments: RoleAssignment[];
  upsertAssignment: (assignment: RoleAssignment) => void;
  setAssignments: (assignments: RoleAssignment[]) => void;
  removeAssignment: (id: string) => void;
}

export const useRoleStore = create<RoleStore>((set) => ({
  assignments: [],

  upsertAssignment: (assignment) =>
    set((state) => {
      const idx = state.assignments.findIndex((a) => a.id === assignment.id);
      if (idx >= 0) {
        const updated = [...state.assignments];
        updated[idx] = assignment;
        return { assignments: updated };
      }
      return { assignments: [...state.assignments, assignment] };
    }),

  setAssignments: (assignments) => set({ assignments }),

  removeAssignment: (id) =>
    set((state) => ({ assignments: state.assignments.filter((a) => a.id !== id) })),
}));

// ═══════════════════════════════════════
//  Build progress store
// ═══════════════════════════════════════

export interface BuildStatus {
  id: string;
  name?: string;
  status: 'started' | 'in-progress' | 'completed' | 'cancelled';
  progress?: number;
  botName?: string;
  metadata?: Record<string, any>;
}

interface BuildStore {
  builds: BuildStatus[];
  upsertBuild: (build: BuildStatus) => void;
  setBuilds: (builds: BuildStatus[]) => void;
}

export const useBuildStore = create<BuildStore>((set) => ({
  builds: [],

  upsertBuild: (build) =>
    set((state) => {
      const idx = state.builds.findIndex((b) => b.id === build.id);
      if (idx >= 0) {
        const updated = [...state.builds];
        updated[idx] = build;
        return { builds: updated };
      }
      return { builds: [build, ...state.builds].slice(0, 100) };
    }),

  setBuilds: (builds) => set({ builds }),
}));

// ═══════════════════════════════════════
//  Supply chain store
// ═══════════════════════════════════════

export interface ChainStatus {
  id: string;
  name?: string;
  status: 'started' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
  currentStage?: string;
  metadata?: Record<string, any>;
}

interface ChainStore {
  chains: ChainStatus[];
  upsertChain: (chain: ChainStatus) => void;
  setChains: (chains: ChainStatus[]) => void;
}

export const useChainStore = create<ChainStore>((set) => ({
  chains: [],

  upsertChain: (chain) =>
    set((state) => {
      const idx = state.chains.findIndex((c) => c.id === chain.id);
      if (idx >= 0) {
        const updated = [...state.chains];
        updated[idx] = chain;
        return { chains: updated };
      }
      return { chains: [chain, ...state.chains].slice(0, 100) };
    }),

  setChains: (chains) => set({ chains }),
}));
