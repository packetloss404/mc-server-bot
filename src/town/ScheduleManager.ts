/**
 * Town ScheduleManager — Phase 3 of the Autonomous Town Builder.
 *
 * Maps (role × day/night phase) -> task descriptions, then pushes those tasks
 * onto the swarm blackboard tagged with the role so resident bots pick them
 * up via their normal `claimBestTask` poll. The brain calls `tick(townId,
 * worldTime)` once per brain tick; the schedule cycles once every 24000
 * ticks (~20 in-game minutes / 1 real-time day on default tick speed).
 *
 * Failure-isolation: every method is best-effort. A missing world time, an
 * unknown role, or a blackboard write failure logs and returns — never
 * throws to the brain.
 *
 * Day/night cutoff follows Minecraft convention: ticks 0..12000 = day,
 * 12000..24000 = night. Dawn/dusk transitions are treated as boundaries
 * (handled implicitly by the tick falling on either side).
 */
import fs from 'fs';
import path from 'path';
import type { TownManager } from './TownManager';
import type { BlackboardManager } from '../voyager/BlackboardManager';
import type { Resident } from './Town';
import type { TownRole } from './RoleManager';
import { atomicWriteJsonSync } from '../util/atomicWrite';
import { logger } from '../util/logger';

export type SchedulePhase = 'day' | 'night';

/**
 * Role schedule: each entry is a task description that gets pushed onto the
 * blackboard at most once per (town, role, phase) window. Keep the wording
 * imperative and short — Voyager will turn it into a runnable spec.
 */
interface ScheduleEntry {
  /** Imperative task description. */
  description: string;
  /** Extra keywords beyond the role tag, to nudge the Voyager planner. */
  keywords: string[];
  /** Optional override of the default 'normal' priority. */
  priority?: 'low' | 'normal' | 'high' | 'critical';
}

/**
 * Role -> phase -> task. Data-driven on purpose so Phase 4 can extend by
 * editing this table rather than adding code paths. The 'idle' role is
 * intentionally bare on both phases — idle bots fall through to the
 * shared swarm tasks the demand-loop pushes.
 */
const SCHEDULES: Record<TownRole, Record<SchedulePhase, ScheduleEntry[]>> = {
  lumberjack: {
    day: [
      {
        description: 'chop nearby trees and stockpile logs',
        keywords: ['wood', 'log', 'tree', 'chop', 'lumberjack'],
      },
    ],
    night: [
      {
        description: 'seek shelter and rest until dawn',
        keywords: ['shelter', 'sleep', 'night', 'rest'],
      },
    ],
  },
  miner: {
    day: [
      {
        description: 'mine cobblestone and ore from nearby exposed stone',
        keywords: ['stone', 'cobblestone', 'mine', 'ore', 'miner'],
      },
    ],
    night: [
      {
        description: 'continue mining underground or shelter at the surface',
        keywords: ['mine', 'shelter', 'night', 'miner'],
      },
    ],
  },
  farmer: {
    day: [
      {
        description: 'tend crops, plant seeds, and harvest mature food',
        keywords: ['farm', 'crop', 'harvest', 'plant', 'wheat', 'farmer'],
      },
    ],
    night: [
      {
        description: 'seek shelter and sleep through the night',
        keywords: ['shelter', 'sleep', 'night', 'rest'],
      },
    ],
  },
  blacksmith: {
    day: [
      {
        description: 'smelt iron and craft tools or armor at the furnace',
        keywords: ['smelt', 'furnace', 'iron', 'craft', 'blacksmith', 'tool'],
      },
    ],
    night: [
      {
        description: 'work at the forge or shelter until dawn',
        keywords: ['shelter', 'sleep', 'night', 'forge'],
      },
    ],
  },
  builder: {
    day: [
      {
        description: 'progress the active town build job or repair damage',
        keywords: ['build', 'place', 'construct', 'repair', 'builder'],
      },
    ],
    night: [
      {
        description: 'seek shelter and rest until morning',
        keywords: ['shelter', 'sleep', 'night', 'rest'],
      },
    ],
  },
  guard: {
    day: [
      {
        description: 'patrol the town perimeter and watch for threats',
        keywords: ['patrol', 'guard', 'defend', 'watch'],
        priority: 'normal',
      },
    ],
    night: [
      {
        description: 'patrol aggressively and fight hostile mobs near town',
        keywords: ['patrol', 'guard', 'fight', 'mob', 'zombie', 'skeleton'],
        priority: 'high',
      },
    ],
  },
  gatherer: {
    day: [
      {
        description: 'gather miscellaneous resources the town is low on',
        keywords: ['gather', 'collect', 'town', 'supply', 'gatherer'],
      },
    ],
    night: [
      {
        description: 'shelter and resume gathering at dawn',
        keywords: ['shelter', 'sleep', 'night', 'rest'],
      },
    ],
  },
  // Idle bots have no scheduled work — they fall through to swarm tasks
  // emitted by the demand loop, which is the whole point of the pool.
  idle: {
    day: [],
    night: [
      {
        description: 'shelter for the night',
        keywords: ['shelter', 'sleep', 'night', 'rest'],
      },
    ],
  },
};

export class ScheduleManager {
  private readonly townManager: TownManager;
  private readonly blackboard: BlackboardManager;
  /**
   * Last-emitted-phase per (townId, role). We only push a new schedule task
   * when the phase flips OR when no matching task currently exists on the
   * board — otherwise the blackboard would grow by N tasks per minute.
   *
   * Followup #42 — persisted to `data/towns/<townId>/schedule.json` so a
   * restart at noon doesn't immediately re-emit the day-phase tasks the
   * blackboard still has open. Loaded lazily on first encounter per town;
   * saved synchronously after each `tick()` mutation. Failures are
   * swallowed + logged.
   */
  private readonly lastEmittedPhase: Map<string, SchedulePhase> = new Map();
  /** Per-town hydration set so we only load each town's slice once. */
  private readonly loadedTowns: Set<string> = new Set();

  constructor(townManager: TownManager, blackboard: BlackboardManager) {
    this.townManager = townManager;
    this.blackboard = blackboard;
  }

  /**
   * Drive one tick. `worldTimeTicks` is the raw 0..24000 Minecraft tick value;
   * when null the brain couldn't read it (no bot online yet) and we fall back
   * to system clock — better to keep cycling than freeze.
   */
  tick(townId: string, worldTimeTicks: number | null): void {
    this.hydrateTown(townId);
    const phase = this.phaseFor(worldTimeTicks);
    const residents = this.townManager
      .listResidents(townId)
      .filter((r) => r.status === 'alive' || r.status == null);
    if (residents.length === 0) return;

    // Group residents by role so we emit at most one task per (role, phase)
    // window. The task itself is plain swarm-priority; the role keyword lets
    // role-tagged bots claim it via the existing scorer.
    const rolesPresent = new Set<TownRole>();
    for (const r of residents) {
      const role = this.roleOf(r);
      rolesPresent.add(role);
    }

    let mutated = false;
    for (const role of rolesPresent) {
      const key = `${townId}::${role}`;
      const last = this.lastEmittedPhase.get(key);
      // Phase didn't flip AND we've already emitted once → skip.
      if (last === phase) continue;
      this.emitForRole(townId, role, phase);
      this.lastEmittedPhase.set(key, phase);
      mutated = true;
    }
    if (mutated) this.persistTown(townId);
  }

  /** Read-only — the task descriptions for a role/phase pair. */
  getScheduleFor(role: TownRole, phase: SchedulePhase): string[] {
    return (SCHEDULES[role]?.[phase] ?? []).map((e) => e.description);
  }

  /** Full schedule table — for the dashboard preview endpoint. */
  getScheduleTable(): Record<TownRole, Record<SchedulePhase, string[]>> {
    const out = {} as Record<TownRole, Record<SchedulePhase, string[]>>;
    for (const role of Object.keys(SCHEDULES) as TownRole[]) {
      out[role] = {
        day: SCHEDULES[role].day.map((e) => e.description),
        night: SCHEDULES[role].night.map((e) => e.description),
      };
    }
    return out;
  }

  /**
   * Translate ticks → phase. Minecraft world time uses 0..24000 where
   * 0..12000 is day and 12000..24000 is night. When ticks is unavailable,
   * fall back to a coarse system-clock guess (6am..6pm = day) so the
   * schedule keeps cycling instead of freezing on first-boot ticks.
   */
  phaseFor(worldTimeTicks: number | null): SchedulePhase {
    if (typeof worldTimeTicks === 'number' && Number.isFinite(worldTimeTicks)) {
      // Normalize negatives / overflow defensively.
      const t = ((worldTimeTicks % 24000) + 24000) % 24000;
      return t < 12000 ? 'day' : 'night';
    }
    const hour = new Date().getHours();
    return hour >= 6 && hour < 18 ? 'day' : 'night';
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Internals
  // ──────────────────────────────────────────────────────────────────────

  private roleOf(r: Resident): TownRole {
    const candidate = r.currentRole ?? 'idle';
    // Only the known role strings produce a defined SCHEDULES entry.
    if (SCHEDULES[candidate as TownRole]) return candidate as TownRole;
    return 'idle';
  }

  /**
   * Followup #42 — load the persisted lastEmittedPhase slice for one town
   * once per process. Failures are swallowed; the manager falls back to an
   * empty in-memory map.
   */
  private hydrateTown(townId: string): void {
    if (this.loadedTowns.has(townId)) return;
    this.loadedTowns.add(townId);
    const file = this.scheduleFileFor(townId);
    if (!file) return;
    try {
      if (!fs.existsSync(file)) return;
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as { lastEmittedPhase?: Record<string, string> };
      if (!parsed?.lastEmittedPhase || typeof parsed.lastEmittedPhase !== 'object') return;
      for (const [role, phase] of Object.entries(parsed.lastEmittedPhase)) {
        if (phase === 'day' || phase === 'night') {
          this.lastEmittedPhase.set(`${townId}::${role}`, phase);
        }
      }
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId, file },
        'ScheduleManager: hydrateTown threw; starting empty',
      );
    }
  }

  private persistTown(townId: string): void {
    const file = this.scheduleFileFor(townId);
    if (!file) return;
    const lastEmittedPhase: Record<string, SchedulePhase> = {};
    const prefix = `${townId}::`;
    for (const [key, phase] of this.lastEmittedPhase.entries()) {
      if (!key.startsWith(prefix)) continue;
      const role = key.slice(prefix.length);
      lastEmittedPhase[role] = phase;
    }
    try {
      atomicWriteJsonSync(file, { lastEmittedPhase });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId, file },
        'ScheduleManager: persistTown failed; in-memory state retained',
      );
    }
  }

  private scheduleFileFor(townId: string): string | null {
    try {
      const tm = this.townManager as { getDataDir?: () => string };
      const dataDir = typeof tm.getDataDir === 'function' ? tm.getDataDir() : null;
      if (!dataDir) return null;
      return path.join(dataDir, 'towns', townId, 'schedule.json');
    } catch {
      return null;
    }
  }

  private emitForRole(townId: string, role: TownRole, phase: SchedulePhase): void {
    const entries = SCHEDULES[role]?.[phase] ?? [];
    for (const entry of entries) {
      try {
        // Tag the task with role + town so idle pickup and other towns'
        // bots score them correctly. The leading `town:<id>` keyword is
        // also what the demand-loop uses — keep them consistent.
        const keywords = ['town', `town:${townId}`, 'phase', phase, role, ...entry.keywords];
        this.blackboard.addTask(
          { description: entry.description, keywords },
          'swarm',
          undefined,
          entry.priority ?? 'normal',
        );
      } catch (err: any) {
        logger.warn(
          { err: err?.message, townId, role, phase },
          'ScheduleManager: addTask failed',
        );
      }
    }
  }
}
