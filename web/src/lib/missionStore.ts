'use client';

import { create } from 'zustand';

export type MissionType =
  | 'queue_task'
  | 'gather_items'
  | 'craft_items'
  | 'smelt_batch'
  | 'build_schematic'
  | 'supply_chain'
  | 'patrol_zone'
  | 'escort_player'
  | 'resupply_builder';

export type MissionStatus = 'draft' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

export type MissionPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface MissionStep {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  error?: string;
}

export interface Mission {
  id: string;
  type: MissionType;
  title: string;
  description?: string;
  assigneeType: 'bot' | 'squad';
  assigneeIds: string[];
  status: MissionStatus;
  priority: MissionPriority;
  steps: MissionStep[];
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  source: string;
}

interface MissionStore {
  missions: Mission[];

  setMissions: (missions: Mission[]) => void;
  upsertMission: (mission: Mission) => void;
  removeMission: (id: string) => void;

  /** Get running missions assigned to a specific bot */
  getRunningForBot: (botName: string) => Mission[];
}

export const useMissionStore = create<MissionStore>((set, get) => ({
  missions: [],

  setMissions: (missions) => set({ missions }),
  upsertMission: (mission) =>
    set((state) => {
      const idx = state.missions.findIndex((m) => m.id === mission.id);
      if (idx >= 0) {
        const updated = [...state.missions];
        updated[idx] = mission;
        return { missions: updated };
      }
      return { missions: [...state.missions, mission] };
    }),
  removeMission: (id) =>
    set((state) => ({ missions: state.missions.filter((m) => m.id !== id) })),

  getRunningForBot: (botName: string) => {
    const lower = botName.toLowerCase();
    return get().missions.filter(
      (m) =>
        m.status === 'running' &&
        m.assigneeIds.some((id) => id.toLowerCase() === lower),
    );
  },
}));
