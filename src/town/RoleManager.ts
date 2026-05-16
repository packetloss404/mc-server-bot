/**
 * Town RoleManager — Phase 3 of the Autonomous Town Builder.
 *
 * One RoleManager per TownManager (not per town — it dispatches by townId).
 * Owns the auto-assignment of `residents.current_role` based on:
 *   1. Resource shortages flagged by the demand-loop (see TownBrain).
 *   2. Personality hints on the bot (matched via the existing
 *      PERSONALITY_KEYWORDS map — a farmer-personality bot prefers the
 *      farmer role, etc.).
 *   3. An `idle` pool that gets pulled into shortage roles when nothing
 *      higher-priority needs the bot.
 *
 * Failure-isolated by design — TownBrain wraps `assignRoles` in `runLoopSafe`
 * and a thrown error inside RoleManager never crashes the brain tick.
 *
 * Not to be confused with `src/control/RoleManager.ts`, which owns fleet-level
 * mission role assignments. This file is town-scoped.
 */
import type { TownManager } from './TownManager';
import type { BotManager } from '../bot/BotManager';
import type { Resident } from './Town';
import { logger } from '../util/logger';

/**
 * Closed set of roles a town resident can hold. Keep this list in sync with
 * the schedule table in ScheduleManager and the dashboard role chips P3-B
 * renders. Add a role here -> add a schedule entry there.
 */
export const TOWN_ROLES = [
  'lumberjack',
  'miner',
  'farmer',
  'blacksmith',
  'builder',
  'guard',
  'gatherer',
  'idle',
] as const;
export type TownRole = (typeof TOWN_ROLES)[number];

/**
 * Personality-to-preferred-role map. Used to break ties when an idle bot could
 * fill several open roles — pick the one their personality wires them for.
 * Personalities not listed here have no preference and are treated as gatherers
 * (generalists).
 */
const PERSONALITY_PREFERENCE: Record<string, TownRole> = {
  farmer: 'farmer',
  blacksmith: 'blacksmith',
  guard: 'guard',
  merchant: 'gatherer',
  explorer: 'gatherer',
  elder: 'builder',
  // The legacy 'builder' personality has no direct entry in PERSONALITY_KEYWORDS
  // but the codegen system seeds bots with it; map it here too.
  builder: 'builder',
};

/** Default core-resource shortages this RoleManager knows how to staff. */
const RESOURCE_ROLE: Record<string, TownRole> = {
  wood: 'lumberjack',
  stone: 'miner',
  food: 'farmer',
  iron: 'blacksmith',
};

/**
 * Minimum staffing targets for a town. Reaches these by pulling from `idle` —
 * never demotes a busy role to fill another, so a tiny town doesn't ping-pong.
 * Keep numbers small and tier-aware so a founding settlement isn't expected to
 * fill all eight slots.
 */
const TIER_TARGETS: Record<string, Partial<Record<TownRole, number>>> = {
  founding: {
    lumberjack: 1,
    farmer: 1,
    guard: 1,
  },
  village: {
    lumberjack: 1,
    miner: 1,
    farmer: 1,
    guard: 1,
    builder: 1,
  },
  town: {
    lumberjack: 2,
    miner: 2,
    farmer: 2,
    guard: 2,
    builder: 1,
    blacksmith: 1,
  },
};

export interface RoleAssignment {
  botName: string;
  fromRole: TownRole | null;
  toRole: TownRole;
  reason: 'shortage' | 'target' | 'manual' | 'init';
}

export class RoleManager {
  private readonly townManager: TownManager;
  private readonly botManager: BotManager;

  constructor(townManager: TownManager, botManager: BotManager) {
    this.townManager = townManager;
    this.botManager = botManager;
  }

  /**
   * Re-balance roles for a town. Reads the current resident roster, computes
   * the gap between current role counts and the tier target, then pulls from
   * the idle pool to close gaps. Returns the list of changes applied so the
   * brain can emit `role:assigned` events.
   *
   * Never demotes a non-idle bot to fill another role — that would cause
   * thrash. If every bot is busy and a role is still under-staffed, the
   * demand-loop's swarm tasks pick up the slack.
   */
  assignRoles(townId: string, shortages: string[] = []): RoleAssignment[] {
    const town = this.townManager.getTown(townId);
    if (!town) return [];
    const residents = this.townManager
      .listResidents(townId)
      .filter((r) => r.status === 'alive' || r.status == null);
    if (residents.length === 0) return [];

    const changes: RoleAssignment[] = [];

    // First pass: every resident with no role gets 'idle' so downstream
    // counting is deterministic. This is also how brand-new joins get woken
    // up — without it they'd stay null-role forever.
    for (const r of residents) {
      if (!r.currentRole || !this.isKnownRole(r.currentRole)) {
        const applied = this.applyRole(townId, r.botName, 'idle', 'init');
        if (applied) {
          changes.push({
            botName: r.botName,
            fromRole: (r.currentRole as TownRole | null) ?? null,
            toRole: 'idle',
            reason: 'init',
          });
          r.currentRole = 'idle';
        }
      }
    }

    // Build the current breakdown after the init pass.
    const counts = this.tallyRoles(residents);

    // Compute desired targets — start from tier defaults, then bump roles for
    // any resource the demand-loop flagged as low.
    const tier = (town.tier as keyof typeof TIER_TARGETS) ?? 'founding';
    const targets: Partial<Record<TownRole, number>> = {
      ...(TIER_TARGETS[tier] ?? TIER_TARGETS.founding),
    };
    for (const resource of shortages) {
      const role = RESOURCE_ROLE[resource];
      if (!role) continue;
      targets[role] = (targets[role] ?? 0) + 1;
    }

    // Pull from idle pool to fill gaps. Sort gaps by largest deficit first so
    // a single tick can resolve multiple shortages fairly.
    const gaps: Array<{ role: TownRole; need: number }> = [];
    for (const [role, want] of Object.entries(targets)) {
      const have = counts[role as TownRole] ?? 0;
      if (have < (want ?? 0)) {
        gaps.push({ role: role as TownRole, need: (want ?? 0) - have });
      }
    }
    gaps.sort((a, b) => b.need - a.need);

    const idlePool = residents.filter((r) => r.currentRole === 'idle');
    for (const gap of gaps) {
      while (gap.need > 0 && idlePool.length > 0) {
        // Prefer bots whose personality maps to this role.
        const pickIdx = this.pickIdleForRole(idlePool, gap.role);
        const pick = idlePool.splice(pickIdx, 1)[0];
        const applied = this.applyRole(townId, pick.botName, gap.role, 'shortage');
        if (applied) {
          changes.push({
            botName: pick.botName,
            fromRole: 'idle',
            toRole: gap.role,
            reason: 'shortage',
          });
          pick.currentRole = gap.role;
        }
        gap.need--;
      }
    }

    if (changes.length > 0) {
      logger.info(
        { townId, changes: changes.length, gaps: gaps.length },
        'RoleManager: roles re-balanced',
      );
    }
    return changes;
  }

  /**
   * Manual override — set a single bot's role. Returns false when the bot
   * isn't a resident or the role isn't recognised.
   */
  setResidentRole(townId: string, botName: string, role: string): boolean {
    if (!this.isKnownRole(role)) return false;
    const applied = this.applyRole(townId, botName, role as TownRole, 'manual');
    if (applied) {
      logger.info({ townId, botName, role }, 'RoleManager: manual role set');
    }
    return applied;
  }

  /** Snapshot of role counts for a town. */
  getRoleBreakdown(townId: string): Record<TownRole, number> {
    const residents = this.townManager
      .listResidents(townId)
      .filter((r) => r.status === 'alive' || r.status == null);
    const counts = this.zeroCounts();
    for (const r of residents) {
      const role = (r.currentRole && this.isKnownRole(r.currentRole)
        ? (r.currentRole as TownRole)
        : 'idle');
      counts[role]++;
    }
    return counts;
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Internals
  // ──────────────────────────────────────────────────────────────────────

  private tallyRoles(residents: Resident[]): Record<TownRole, number> {
    const counts = this.zeroCounts();
    for (const r of residents) {
      const role =
        r.currentRole && this.isKnownRole(r.currentRole)
          ? (r.currentRole as TownRole)
          : 'idle';
      counts[role]++;
    }
    return counts;
  }

  private zeroCounts(): Record<TownRole, number> {
    const out = {} as Record<TownRole, number>;
    for (const r of TOWN_ROLES) out[r] = 0;
    return out;
  }

  private isKnownRole(role: string): role is TownRole {
    return (TOWN_ROLES as readonly string[]).includes(role);
  }

  /**
   * Pick the idle resident whose personality best matches `role`. Falls back
   * to the first idle if no personality info is available. The personality
   * tag lives on the bot worker (BotManager owns it), not on the resident.
   */
  private pickIdleForRole(idlePool: Resident[], role: TownRole): number {
    for (let i = 0; i < idlePool.length; i++) {
      const personality = this.personalityFor(idlePool[i].botName);
      if (!personality) continue;
      if (PERSONALITY_PREFERENCE[personality.toLowerCase()] === role) {
        return i;
      }
    }
    return 0;
  }

  private personalityFor(botName: string): string | null {
    const worker = this.botManager
      .getAllWorkers()
      .find((w) => w.botName.toLowerCase() === botName.toLowerCase());
    if (!worker) return null;
    // The cached status carries 'personality' on basic and detailed shapes.
    const basic = worker.getCachedStatus?.();
    if (basic?.personality) return basic.personality as string;
    const detailed = worker.getCachedDetailedStatus?.();
    if (detailed?.personality) return detailed.personality as string;
    return null;
  }

  /**
   * Persist the role change. Goes through TownManager so DB mutations stay in
   * one place. Returns false if the resident doesn't exist or the write
   * fails — never throws.
   */
  private applyRole(
    townId: string,
    botName: string,
    role: TownRole,
    reason: RoleAssignment['reason'],
  ): boolean {
    try {
      return this.townManager.setResidentRole(townId, botName, role);
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId, botName, role, reason },
        'RoleManager: applyRole failed',
      );
      return false;
    }
  }
}
