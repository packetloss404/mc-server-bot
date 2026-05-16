/**
 * TradeRouteManager — Phase 7-B (allied-town resource sharing).
 *
 * Detects cross-town surplus/shortage matches between allied towns and drops
 * a swarm-priority blackboard task on the source town to deliver N <resource>
 * to the peer town. The actual delivery is left to the existing Voyager loop
 * + supply-chain infrastructure — this manager only emits the trigger and
 * records the in-flight route so the same (source, target, resource) tuple
 * isn't re-queued every tick.
 *
 * Inputs the manager pulls per tick:
 *   - The tick's source town + its aggregate resident inventory totals.
 *   - The diplomacy graph (via TownManager.getDiplomacyManager when P7-A
 *     wires it). When the manager is missing OR the towns aren't `allied`,
 *     the tick short-circuits.
 *   - Per-peer thresholds (CORE_RESOURCE_THRESHOLDS — copied locally to
 *     avoid coupling with TownBrain at runtime).
 *
 * Outputs:
 *   - A BlackboardManager.addTask call: source-priority swarm task tagged
 *     with the resource, the target town name, and 'trade'/'town' keywords
 *     so a Voyager-loop bot in the source town picks it up.
 *   - A `trade:queued` event recorded against the source town for the
 *     dashboard feed.
 *   - In-memory tracking of the open route so duplicate emits during the
 *     ~10-minute cooldown window are suppressed.
 *
 * Persistence: in-memory only for Phase 7. The Map<sourceTownId, TradeRoute[]>
 * is populated by tick() and lives for the process lifetime; restart is the
 * intentional reset surface.
 */
import type { TownManager } from './TownManager';
import type { BotManager } from '../bot/BotManager';
import type { BlackboardManager } from '../voyager/BlackboardManager';
import type { Town, TownTier } from './Town';
import {
  CORE_RESOURCE_THRESHOLDS,
  RESOURCE_KEYWORDS,
} from './resourceThresholds';
import { logger } from '../util/logger';

/** Cooldown between re-queues of the same (sourceTownId, targetTownId, resource). */
const ROUTE_COOLDOWN_MS = 10 * 60 * 1000;

/**
 * One in-flight allied-town trade route. Lives in memory for the process
 * lifetime; the cooldown window (`expiresAt`) acts as the natural GC.
 *
 * Public DTO contract — the dashboard's TradeRoutesCard renders this shape.
 * P7-A and any future supply-chain integration should treat the field set as
 * stable (additive only).
 */
export interface TradeRoute {
  id: string;
  sourceTownId: string;
  sourceTownName: string;
  targetTownId: string;
  targetTownName: string;
  resource: string;
  amount: number;
  /** Timestamp when this route was queued (ms epoch). */
  queuedAt: number;
  /** Cooldown horizon — re-queue is suppressed until now > expiresAt. */
  expiresAt: number;
  /** The blackboard task id we queued; useful for cross-referencing. */
  taskId: string | null;
}

/**
 * Optional shape we expect P7-A's DiplomacyManager to expose so we can scan
 * peer relationships. We deliberately keep the surface area minimal and use
 * structural typing — that way we can boot before P7-A merges and degrade
 * cleanly when the manager isn't wired yet.
 */
interface DiplomacyManagerLike {
  /** Return every directed edge originating from the given townId. */
  listOutgoing?: (townId: string) => Array<{
    peerTownId: string;
    state: 'allied' | 'rival' | 'neutral' | string;
    trust?: number;
  }>;
  /** Convenience accessor used as a fallback when listOutgoing isn't present. */
  getRelationship?: (
    townIdA: string,
    townIdB: string,
  ) => { state: 'allied' | 'rival' | 'neutral' | string } | null;
}

/**
 * Minimal accessor so P7-A's DiplomacyManager can be looked up without us
 * declaring a hard dependency. TownManager.getDiplomacyManager() will be
 * added by P7-A; until then this returns undefined and the manager no-ops.
 */
function getDiplomacyManager(townManager: TownManager): DiplomacyManagerLike | null {
  const tm = townManager as unknown as {
    getDiplomacyManager?: () => DiplomacyManagerLike | null;
  };
  if (typeof tm.getDiplomacyManager !== 'function') return null;
  try {
    return tm.getDiplomacyManager() ?? null;
  } catch (err: any) {
    logger.warn(
      { err: err?.message },
      'TradeRouteManager: getDiplomacyManager threw; treating as missing',
    );
    return null;
  }
}

export class TradeRouteManager {
  private readonly townManager: TownManager;
  private readonly botManager: BotManager;
  private readonly blackboard: BlackboardManager;
  /**
   * Per-source-town in-flight routes. Cleared lazily on each tick by
   * dropping any entry whose `expiresAt` has passed. Restart resets the map,
   * which is intentional for Phase 7 (persistence is followup-grade).
   */
  private readonly openRoutes: Map<string, TradeRoute[]> = new Map();

  constructor(
    townManager: TownManager,
    botManager: BotManager,
    blackboard: BlackboardManager,
  ) {
    this.townManager = townManager;
    this.botManager = botManager;
    this.blackboard = blackboard;
  }

  /**
   * Run one tick for the given source town. Returns the routes that were
   * NEWLY queued during this tick (existing-but-still-cooling routes are
   * not returned; use getOpenRoutes for the full picture).
   *
   * Safe to call when:
   *   - The town has zero residents — returns [] without touching peers.
   *   - The diplomacy manager isn't wired — returns [] (no allies known).
   *   - No peers are `allied` — returns [].
   *   - No surplus resources match a peer's shortage — returns [].
   */
  tick(sourceTownId: string): TradeRoute[] {
    this.gcExpired(sourceTownId);

    const sourceTown = this.townManager.getTown(sourceTownId);
    if (!sourceTown) return [];
    if (sourceTown.status !== 'active') return [];
    if (!sourceTown.capital) return [];

    const sourceResidents = this.townManager.listResidents(sourceTownId);
    if (sourceResidents.length === 0) return [];

    const diplomacy = getDiplomacyManager(this.townManager);
    if (!diplomacy) return [];

    const peers = this.findAlliedPeers(sourceTownId, diplomacy);
    if (peers.length === 0) return [];

    const sourceTotals = this.aggregateResidentInventory(
      sourceResidents.map((r) => r.botName),
    );
    const sourceThresholds =
      CORE_RESOURCE_THRESHOLDS[sourceTown.tier as TownTier] ??
      CORE_RESOURCE_THRESHOLDS.founding;
    // A resource is "surplus" when source holds > 2x its tier threshold.
    const surplus: Record<string, number> = {};
    for (const [resource, threshold] of Object.entries(sourceThresholds)) {
      const have = sourceTotals[resource] ?? 0;
      if (have > 2 * threshold) {
        surplus[resource] = have - 2 * threshold;
      }
    }
    if (Object.keys(surplus).length === 0) return [];

    const queued: TradeRoute[] = [];
    for (const peer of peers) {
      const peerTown = this.townManager.getTown(peer.peerTownId);
      if (!peerTown || peerTown.status !== 'active') continue;
      const peerResidents = this.townManager.listResidents(peerTown.id);
      if (peerResidents.length === 0) continue;
      const peerTotals = this.aggregateResidentInventory(
        peerResidents.map((r) => r.botName),
      );
      const peerThresholds =
        CORE_RESOURCE_THRESHOLDS[peerTown.tier as TownTier] ??
        CORE_RESOURCE_THRESHOLDS.founding;

      for (const [resource, surplusAmount] of Object.entries(surplus)) {
        const peerHave = peerTotals[resource] ?? 0;
        const peerThreshold = peerThresholds[resource] ?? 0;
        if (peerThreshold === 0) continue; // no demand baseline -> no shortage signal
        if (peerHave >= peerThreshold) continue; // peer is satisfied
        // Cap the route at min(surplus, demand-gap) so we don't queue absurd
        // numbers. Round up so a tiny shortage still produces a deliverable.
        const need = peerThreshold - peerHave;
        const amount = Math.max(1, Math.min(surplusAmount, need));

        if (this.hasOpenRoute(sourceTownId, peer.peerTownId, resource)) continue;

        const route = this.queueRoute({
          source: sourceTown,
          target: peerTown,
          resource,
          amount,
        });
        if (route) queued.push(route);
      }
    }

    return queued;
  }

  /** Snapshot of currently in-flight routes from the given source town. */
  getOpenRoutes(sourceTownId: string): TradeRoute[] {
    this.gcExpired(sourceTownId);
    const list = this.openRoutes.get(sourceTownId);
    if (!list) return [];
    // Defensive copy — callers should not mutate the internal store.
    return list.map((r) => ({ ...r }));
  }

  // ──────────────────────────────────────────────────────────────────────
  //  Internals
  // ──────────────────────────────────────────────────────────────────────

  private hasOpenRoute(
    sourceTownId: string,
    targetTownId: string,
    resource: string,
  ): boolean {
    const list = this.openRoutes.get(sourceTownId);
    if (!list) return false;
    const now = Date.now();
    return list.some(
      (r) =>
        r.targetTownId === targetTownId &&
        r.resource === resource &&
        r.expiresAt > now,
    );
  }

  private queueRoute(input: {
    source: Town;
    target: Town;
    resource: string;
    amount: number;
  }): TradeRoute | null {
    const { source, target, resource, amount } = input;
    const now = Date.now();
    const id = `trade-${source.id}-${target.id}-${resource}-${now.toString(36)}`;

    let taskId: string | null = null;
    try {
      const description = `town:${source.id} ally trade — deliver ${amount} ${resource} to ${target.name}`;
      // Followup #61 (Phase 8-followup): emit a structured metadata blob
      // alongside the NL description so the Voyager loop / a future
      // ChainCoordinator integration can dispatch a real
      // gather→walk→deposit pipeline instead of relying on keyword match
      // + LLM improvisation. The metadata.kind discriminator is the
      // forward-compat contract; see BlackboardTask.metadata docstring.
      const targetCapital = target.capital
        ? { x: target.capital.x, y: target.capital.y, z: target.capital.z }
        : null;
      const tradeMetadata: Record<string, unknown> = {
        kind: 'trade-route',
        sourceTownId: source.id,
        sourceTownName: source.name,
        targetTownId: target.id,
        targetTownName: target.name,
        resource,
        amount,
        targetCapital,
      };
      const task = this.blackboard.addTask(
        {
          description,
          keywords: [resource, 'trade', 'town', 'ally', 'supply', target.name.toLowerCase()],
        },
        'swarm',
        undefined,
        'high',
        targetCapital ?? undefined,
        tradeMetadata,
      );
      taskId = task?.id ?? null;
    } catch (err: any) {
      logger.warn(
        {
          err: err?.message,
          sourceTownId: source.id,
          targetTownId: target.id,
          resource,
        },
        'TradeRouteManager: blackboard.addTask threw',
      );
      return null;
    }

    const route: TradeRoute = {
      id,
      sourceTownId: source.id,
      sourceTownName: source.name,
      targetTownId: target.id,
      targetTownName: target.name,
      resource,
      amount,
      queuedAt: now,
      expiresAt: now + ROUTE_COOLDOWN_MS,
      taskId,
    };
    const list = this.openRoutes.get(source.id) ?? [];
    list.push(route);
    this.openRoutes.set(source.id, list);

    try {
      this.townManager.recordEvent({
        townId: source.id,
        kind: 'trade:queued',
        severity: 'info',
        payload: {
          targetTownId: target.id,
          targetTownName: target.name,
          resource,
          amount,
          taskId,
        },
        highlightScore: 25,
      });
    } catch (err: any) {
      logger.warn(
        { err: err?.message, sourceTownId: source.id, targetTownId: target.id },
        'TradeRouteManager: recordEvent threw (route still queued)',
      );
    }

    logger.info(
      {
        sourceTownId: source.id,
        targetTownId: target.id,
        resource,
        amount,
      },
      'TradeRouteManager: queued allied trade route',
    );
    return route;
  }

  /**
   * Drop expired entries for the given source. Called at the head of every
   * tick + at every getOpenRoutes read so the in-memory state never grows
   * unbounded.
   */
  private gcExpired(sourceTownId: string): void {
    const list = this.openRoutes.get(sourceTownId);
    if (!list) return;
    const now = Date.now();
    const fresh = list.filter((r) => r.expiresAt > now);
    if (fresh.length === list.length) return;
    if (fresh.length === 0) {
      this.openRoutes.delete(sourceTownId);
    } else {
      this.openRoutes.set(sourceTownId, fresh);
    }
  }

  /**
   * Walk the diplomacy graph for the given source town and return every peer
   * whose state is 'allied'. We support two manager shapes:
   *   1. The richer `listOutgoing` accessor (preferred — single call).
   *   2. A fallback walk over every other town via `getRelationship`.
   *
   * If neither is present we return [] and the tick is a no-op.
   */
  private findAlliedPeers(
    sourceTownId: string,
    diplomacy: DiplomacyManagerLike,
  ): Array<{ peerTownId: string }> {
    if (typeof diplomacy.listOutgoing === 'function') {
      try {
        const edges = diplomacy.listOutgoing(sourceTownId) ?? [];
        // P7-A's Relationship shape uses (townIdA, townIdB) — derive the
        // peer as the side that's NOT the source. listOutgoing scopes
        // to outgoing-from-source, so townIdB is the peer in practice,
        // but cover both sides defensively.
        return edges
          .filter((e: any) => e?.state === 'allied')
          .map((e: any) => {
            const peerTownId =
              e.peerTownId ??
              (e.townIdA === sourceTownId ? e.townIdB : e.townIdA);
            return { peerTownId };
          })
          .filter((p) => typeof p.peerTownId === 'string');
      } catch (err: any) {
        logger.warn(
          { err: err?.message, sourceTownId },
          'TradeRouteManager: listOutgoing threw',
        );
        return [];
      }
    }
    if (typeof diplomacy.getRelationship === 'function') {
      const allies: Array<{ peerTownId: string }> = [];
      for (const town of this.townManager.listTowns()) {
        if (town.id === sourceTownId) continue;
        try {
          const rel = diplomacy.getRelationship(sourceTownId, town.id);
          if (rel?.state === 'allied') {
            allies.push({ peerTownId: town.id });
          }
        } catch {
          /* swallow per-peer */
        }
      }
      return allies;
    }
    return [];
  }

  /**
   * Bot-inventory aggregation that mirrors TownBrain.aggregateResidentInventory
   * — duplicated here so we don't import from the brain (circular dep risk).
   */
  private aggregateResidentInventory(botNames: string[]): Record<string, number> {
    const totals: Record<string, number> = { wood: 0, stone: 0, food: 0, iron: 0 };
    if (botNames.length === 0) return totals;
    const wantedSet = botNames.map((n) => n.toLowerCase());
    const workers = this.botManager.getAllWorkers();
    for (const worker of workers) {
      if (!wantedSet.includes(worker.botName.toLowerCase())) continue;
      const status = worker.getCachedStatus?.();
      const inv = (status?.inventory ?? {}) as Record<string, number>;
      for (const [rawName, count] of Object.entries(inv)) {
        if (typeof count !== 'number') continue;
        const name = rawName.startsWith('minecraft:') ? rawName.slice(10) : rawName;
        for (const [resource, pattern] of Object.entries(RESOURCE_KEYWORDS)) {
          if (pattern.test(name)) {
            totals[resource] = (totals[resource] ?? 0) + count;
            break;
          }
        }
      }
    }
    return totals;
  }
}
