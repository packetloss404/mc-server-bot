/**
 * TradeRouteManager smoke test (followup).
 *
 * Seeds two active towns + an `allied` diplomacy edge between them, gives
 * the source town a pile of surplus wood, and asserts the manager queues a
 * route + a blackboard task on a single tick().
 *
 * The TradeRouteManager only touches:
 *   - TownManager.getTown / listTowns / listResidents / getDiplomacyManager / recordEvent
 *   - BotManager.getAllWorkers (each worker exposes botName + getCachedStatus)
 *   - BlackboardManager.addTask
 *
 * We supply hand-rolled fakes for all three so the test boots without disk
 * or DB.
 */
import { describe, it, expect } from 'vitest';
import { TradeRouteManager } from '../../src/town/TradeRouteManager';
import type { TownManager } from '../../src/town/TownManager';
import type { BotManager } from '../../src/bot/BotManager';
import type { BlackboardManager } from '../../src/voyager/BlackboardManager';
import type { Town, Resident } from '../../src/town/Town';

interface FakeWorker {
  botName: string;
  getCachedStatus: () => { inventory: Record<string, number> };
}

function makeTown(overrides: Partial<Town>): Town {
  return {
    id: overrides.id ?? 'unknown',
    name: overrides.name ?? 'Unknown',
    foundedAt: overrides.foundedAt ?? Date.now(),
    capital: overrides.capital ?? { x: 0, y: 64, z: 0 },
    tier: overrides.tier ?? 'founding',
    status: overrides.status ?? 'active',
    populationTarget: overrides.populationTarget ?? null,
    allianceState: overrides.allianceState ?? null,
    parentTownId: overrides.parentTownId ?? null,
    styleSeed: overrides.styleSeed ?? 'medieval-communal',
    config: overrides.config ?? {},
  };
}

function makeResident(townId: string, botName: string): Resident {
  return {
    id: `res-${botName}`,
    townId,
    botName,
    joinedAt: Date.now(),
    currentRole: 'lumberjack',
    status: 'alive',
  };
}

describe('TradeRouteManager — allied edge → route queued smoke test', () => {
  it('queues a swarm task and records a trade:queued event when surplus meets shortage', () => {
    // ── Seed two towns. ────────────────────────────────────────────────
    const sourceTown = makeTown({
      id: 'source',
      name: 'Source',
      capital: { x: 0, y: 64, z: 0 },
      tier: 'founding',
    });
    const targetTown = makeTown({
      id: 'target',
      name: 'Target',
      capital: { x: 100, y: 64, z: 100 },
      tier: 'founding',
    });
    const towns = new Map<string, Town>([
      ['source', sourceTown],
      ['target', targetTown],
    ]);
    const sourceResidents: Resident[] = [makeResident('source', 'AlphaBot')];
    const targetResidents: Resident[] = [makeResident('target', 'BetaBot')];

    // ── Recorded events for inspection. ────────────────────────────────
    const recordedEvents: Array<{ townId: string; kind: string; payload?: unknown }> = [];

    // ── Fake DiplomacyManager: source -> target is allied. ─────────────
    const diplomacy = {
      listOutgoing(townId: string) {
        if (townId === 'source') {
          return [
            {
              peerTownId: 'target',
              state: 'allied' as const,
              trust: 90,
            },
          ];
        }
        return [];
      },
    };

    // ── Fake TownManager. ─────────────────────────────────────────────
    const tm = {
      getTown(id: string): Town | null {
        return towns.get(id) ?? null;
      },
      listTowns(): Town[] {
        return Array.from(towns.values());
      },
      listResidents(townId: string): Resident[] {
        if (townId === 'source') return sourceResidents;
        if (townId === 'target') return targetResidents;
        return [];
      },
      getDiplomacyManager() {
        return diplomacy;
      },
      recordEvent(input: { townId: string; kind: string; payload?: unknown }) {
        recordedEvents.push(input);
        return { id: `ev-${recordedEvents.length}`, ...input };
      },
    } as unknown as TownManager;

    // ── Fake BotManager. The source bot has 256 oak_log (way over the
    //    founding-tier wood threshold of 32 → surplus). The target bot has
    //    nothing → shortage. ────────────────────────────────────────────
    const sourceWorker: FakeWorker = {
      botName: 'AlphaBot',
      getCachedStatus: () => ({ inventory: { 'minecraft:oak_log': 256 } }),
    };
    const targetWorker: FakeWorker = {
      botName: 'BetaBot',
      getCachedStatus: () => ({ inventory: {} }),
    };
    const bm = {
      getAllWorkers(): FakeWorker[] {
        return [sourceWorker, targetWorker];
      },
    } as unknown as BotManager;

    // ── Fake BlackboardManager. Just records addTask calls. ────────────
    const addedTasks: Array<{
      description: string;
      keywords: string[];
      priority: string;
    }> = [];
    const blackboard = {
      addTask(
        task: { description: string; keywords: string[] },
        _source: string,
        _goalId: string | undefined,
        priority: string,
      ) {
        const stored = {
          id: `task-${addedTasks.length + 1}`,
          description: task.description,
          keywords: task.keywords,
          priority,
        };
        addedTasks.push({
          description: task.description,
          keywords: task.keywords,
          priority,
        });
        return stored;
      },
    } as unknown as BlackboardManager;

    // ── Drive one tick. ────────────────────────────────────────────────
    const manager = new TradeRouteManager(tm, bm, blackboard);
    const queued = manager.tick('source');

    // ── Assertions. ────────────────────────────────────────────────────
    // 1) The manager returns the newly-queued routes (one — wood).
    expect(queued).toHaveLength(1);
    expect(queued[0].sourceTownId).toBe('source');
    expect(queued[0].targetTownId).toBe('target');
    expect(queued[0].resource).toBe('wood');
    expect(queued[0].amount).toBeGreaterThan(0);

    // 2) The blackboard saw exactly one addTask, swarm-priority 'high',
    //    tagged with the resource + 'trade' + the target town name.
    expect(addedTasks).toHaveLength(1);
    expect(addedTasks[0].priority).toBe('high');
    expect(addedTasks[0].keywords).toContain('wood');
    expect(addedTasks[0].keywords).toContain('trade');
    expect(addedTasks[0].keywords).toContain('target');
    expect(addedTasks[0].description).toMatch(/deliver \d+ wood/);

    // 3) The town manager saw a 'trade:queued' event recorded against the
    //    source town.
    const tradeEvents = recordedEvents.filter((e) => e.kind === 'trade:queued');
    expect(tradeEvents).toHaveLength(1);
    expect(tradeEvents[0].townId).toBe('source');

    // 4) Calling tick() again immediately is a no-op (cooldown gate).
    const queuedAgain = manager.tick('source');
    expect(queuedAgain).toHaveLength(0);
    expect(addedTasks).toHaveLength(1); // still just the original task
  });

  it('returns [] when the diplomacy manager isn\'t wired', () => {
    const sourceTown = makeTown({
      id: 'source',
      name: 'Source',
      capital: { x: 0, y: 64, z: 0 },
    });
    const tm = {
      getTown: (id: string) => (id === 'source' ? sourceTown : null),
      listTowns: () => [sourceTown],
      listResidents: () => [makeResident('source', 'AlphaBot')],
      // Note: no getDiplomacyManager exposed.
      recordEvent: () => ({ id: 'ev-1', townId: 'source', kind: 'noop' }),
    } as unknown as TownManager;
    const bm = {
      getAllWorkers: () => [
        {
          botName: 'AlphaBot',
          getCachedStatus: () => ({ inventory: {} }),
        },
      ],
    } as unknown as BotManager;
    const blackboard = {
      addTask: () => ({ id: 't1' }),
    } as unknown as BlackboardManager;

    const manager = new TradeRouteManager(tm, bm, blackboard);
    expect(manager.tick('source')).toEqual([]);
  });
});
