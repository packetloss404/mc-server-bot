'use client';

import { create } from 'zustand';

export interface Squad {
  id: string;
  name: string;
  botNames: string[];
  defaultRole?: string;
  homeMarkerId?: string;
  activeMissionId?: string;
  createdAt: number;
  updatedAt: number;
}

export type RoleType = 'guard' | 'builder' | 'hauler' | 'farmer' | 'miner' | 'scout' | 'merchant' | 'free-agent';

export type AutonomyLevel = 'manual' | 'assisted' | 'autonomous';

export interface RoleAssignment {
  id: string;
  botName: string;
  role: RoleType;
  autonomyLevel: AutonomyLevel;
  homeMarkerId?: string;
  allowedZoneIds: string[];
  preferredMissionTypes: string[];
}

interface FleetStore {
  squads: Squad[];
  roles: RoleAssignment[];

  setSquads: (squads: Squad[]) => void;
  upsertSquad: (squad: Squad) => void;
  removeSquad: (id: string) => void;
  setRoles: (roles: RoleAssignment[]) => void;
  upsertRole: (role: RoleAssignment) => void;
}

export const useFleetStore = create<FleetStore>((set) => ({
  squads: [],
  roles: [],

  setSquads: (squads) => set({ squads }),
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
  removeSquad: (id) =>
    set((state) => ({ squads: state.squads.filter((s) => s.id !== id) })),
  setRoles: (roles) => set({ roles }),
  upsertRole: (role) =>
    set((state) => {
      const idx = state.roles.findIndex((r) => r.id === role.id);
      if (idx >= 0) {
        const updated = [...state.roles];
        updated[idx] = role;
        return { roles: updated };
      }
      return { roles: [...state.roles, role] };
    }),
}));
