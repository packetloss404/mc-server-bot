/**
 * BuildCoordinator.autoGather pre-stage tests (task #71).
 *
 * Targets the chunk-planning + skill-catalog-discovery surface added in this
 * task. We don't boot a full bot fleet or NBT-parse a schematic; instead, we
 * subclass BuildCoordinator to inject hand-rolled bot inventories and assert
 * the gather plan matches expectations (chunk sizes, descriptions, per-bot
 * shortfall math, total chunk cap).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BuildCoordinator } from '../../src/build/BuildCoordinator';
import type { BotManager } from '../../src/bot/BotManager';
import type { EventLog } from '../../src/server/EventLog';

/**
 * Tiny subclass that lets us stub the bot inventory (without instantiating
 * real workers) and exposes the protected helpers we want to assert against.
 */
class TestableCoordinator extends BuildCoordinator {
  public inventoryByBot = new Map<string, Map<string, number>>();

  protected getBotInventory(botName: string): Map<string, number> {
    return this.inventoryByBot.get(botName) ?? new Map();
  }

  // Re-expose protected helpers for direct assertion.
  public callPlanGather(botNames: string[], requirement: Map<string, number>) {
    return (this as any).planGather(botNames, requirement);
  }

  public callGetCatalog(force = false) {
    return (this as any).getSkillChunkCatalog(force);
  }

  public callComputeRequirement(blocks: ReadonlyArray<{ name: string }>) {
    return (this as any).computeMaterialRequirement(blocks);
  }
}

// Build a tiny temp skills/ dir so the catalog discovery is deterministic and
// doesn't depend on whatever skills happen to be cached on the test host.
let originalCwd: string;
let tmpRoot: string;

const FIXTURE_SKILLS = [
  // cobblestone: chunks of 1, 8, 10, 16 → largest = 16
  'mine_1_cobblestone.js',
  'mine_8_cobblestone.js',
  'mine_10_cobblestone.js',
  'mine_16_cobblestone.js',
  // oak_log: chunks of 1, 3, 10 — largest = 10
  'mine_1_oak_log.js',
  'mine_3_oak_logs.js',
  'mine_10_oak_logs.js',
  // oak_planks: craftable in 4 / 8 / 12
  'craft_4_oak_planks.js',
  'craft_8_oak_planks.js',
  'craft_12_oak_planks.js',
  // dirt: chunks of 1, 16
  'mine_1_dirt.js',
  'mine_16_dirt.js',
  // Unrelated junk for noise.
  'wander_randomly.js',
  'craft_a_wooden_pickaxe.js',
];

function makeMinimalManagerStub(): BotManager {
  return {
    getWorker: () => undefined,
  } as unknown as BotManager;
}

function makeIoStub() {
  return {
    emit: () => undefined,
  } as any;
}

function makeEventLogStub(): EventLog {
  return {
    push: () => ({ id: 0, type: 'noop', botName: '', description: '', metadata: {}, ts: 0 }),
  } as unknown as EventLog;
}

beforeAll(() => {
  // Stand up a tmp dir with skills/ + schematics/ + data/.
  originalCwd = process.cwd();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dyobot-build-autogather-'));
  fs.mkdirSync(path.join(tmpRoot, 'skills'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'schematics'), { recursive: true });
  fs.mkdirSync(path.join(tmpRoot, 'data'), { recursive: true });
  for (const file of FIXTURE_SKILLS) {
    fs.writeFileSync(path.join(tmpRoot, 'skills', file), '// stub skill\n');
  }
  process.chdir(tmpRoot);
});

afterAll(() => {
  process.chdir(originalCwd);
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('BuildCoordinator autoGather pre-stage', () => {
  it('discovers the largest available chunk size for each resource', () => {
    const coord = new TestableCoordinator(makeMinimalManagerStub(), makeIoStub(), makeEventLogStub());
    const catalog = coord.callGetCatalog(true);

    // Cobblestone has skills with N in {1,8,10,16} → largest is 16.
    expect(catalog.get('cobblestone')?.chunkSize).toBe(16);
    // Oak log: {1, 3, 10} → 10. We normalize both singular + plural forms so
    // either key resolves to the same chunk.
    const oakLog = catalog.get('oak_log') ?? catalog.get('oak_logs');
    expect(oakLog?.chunkSize).toBe(10);
    // Oak planks: {4, 8, 12} → 12.
    expect(catalog.get('oak_planks')?.chunkSize).toBe(12);
    // Dirt: {1, 16} → 16.
    expect(catalog.get('dirt')?.chunkSize).toBe(16);
  });

  it('computes the per-material requirement from a schematic block list', () => {
    const coord = new TestableCoordinator(makeMinimalManagerStub(), makeIoStub(), makeEventLogStub());
    const req = coord.callComputeRequirement([
      { name: 'minecraft:cobblestone' },
      { name: 'cobblestone' },
      { name: 'minecraft:oak_planks' },
      { name: 'oak_planks' },
      { name: 'oak_planks' },
    ]);
    // `minecraft:` prefix is stripped during normalization.
    expect(req.get('cobblestone')).toBe(2);
    expect(req.get('oak_planks')).toBe(3);
  });

  it('queues floor(shortage/chunk)+1 chunks per (bot, material) shortfall', () => {
    const coord = new TestableCoordinator(makeMinimalManagerStub(), makeIoStub(), makeEventLogStub());

    // Single bot, single material: need 32 cobblestone, have 0 → with chunk=16,
    // queue floor(32/16)+1 = 3 chunks. (NOT 2 — the +1 buffer is intentional
    // so the bot overshoots slightly and clears the bar.)
    coord.inventoryByBot.set('Bot1', new Map());
    const req = new Map<string, number>([['cobblestone', 32]]);
    const { plan } = coord.callPlanGather(['Bot1'], req);
    const cobbleChunks = plan.filter((p) => p.resource === 'cobblestone');
    expect(cobbleChunks).toHaveLength(3);
    // Each chunk should reference a real cached skill file and use the
    // largest available chunk size (16).
    for (const entry of cobbleChunks) {
      expect(entry.botName).toBe('Bot1');
      expect(entry.chunkSize).toBe(16);
      expect(entry.skillFile).toBe('mine_16_cobblestone.js');
      expect(entry.description).toMatch(/^Mine 16 cobblestone$/);
    }
  });

  it('splits requirement evenly across bots and accounts for existing inventory', () => {
    const coord = new TestableCoordinator(makeMinimalManagerStub(), makeIoStub(), makeEventLogStub());

    // Two bots, 168-block cottage with 100 cobblestone + 68 oak_planks.
    // Per-bot share: 50 cobble, 34 oak_planks.
    // Bot1 already has 32 cobble (shortage 18) and 0 planks (shortage 34).
    // Bot2 has 0 of everything.
    coord.inventoryByBot.set('Bot1', new Map([['cobblestone', 32]]));
    coord.inventoryByBot.set('Bot2', new Map());

    const req = new Map<string, number>([
      ['cobblestone', 100],
      ['oak_planks', 68],
    ]);
    const { plan } = coord.callPlanGather(['Bot1', 'Bot2'], req);

    // Bot1 cobble: shortage 18 / chunk 16 → 2 chunks.
    const bot1Cobble = plan.filter((p) => p.botName === 'Bot1' && p.resource === 'cobblestone');
    expect(bot1Cobble).toHaveLength(2);

    // Bot2 cobble: shortage 50 / chunk 16 → 4 chunks (floor(50/16)=3 + 1).
    const bot2Cobble = plan.filter((p) => p.botName === 'Bot2' && p.resource === 'cobblestone');
    expect(bot2Cobble).toHaveLength(4);

    // Oak planks (chunk 12): both bots short 34 → floor(34/12)+1 = 3 chunks each.
    const bot1Planks = plan.filter((p) => p.botName === 'Bot1' && p.resource === 'oak_planks');
    const bot2Planks = plan.filter((p) => p.botName === 'Bot2' && p.resource === 'oak_planks');
    expect(bot1Planks).toHaveLength(3);
    expect(bot2Planks).toHaveLength(3);
  });

  it('skips a material when no skill chunk is cached for it', () => {
    const coord = new TestableCoordinator(makeMinimalManagerStub(), makeIoStub(), makeEventLogStub());
    coord.inventoryByBot.set('Bot1', new Map());
    // `obsidian` has no skill in our fixture set → should be quietly skipped.
    const req = new Map<string, number>([['obsidian', 64]]);
    const { plan } = coord.callPlanGather(['Bot1'], req);
    expect(plan).toHaveLength(0);
  });

  it('caps the total chunk count at the safety upper bound', () => {
    const coord = new TestableCoordinator(makeMinimalManagerStub(), makeIoStub(), makeEventLogStub());
    coord.inventoryByBot.set('Bot1', new Map());
    // Stupendous cobble shortage that, with chunk size 16, would otherwise
    // queue 626 tasks. The cap should clamp it at 50.
    const req = new Map<string, number>([['cobblestone', 10_000]]);
    const { plan } = coord.callPlanGather(['Bot1'], req);
    expect(plan.length).toBeLessThanOrEqual(50);
    // And it should be exactly the cap when a single huge shortage saturates it.
    expect(plan.length).toBe(50);
  });

  it('produces an empty plan when every bot already has its share', () => {
    const coord = new TestableCoordinator(makeMinimalManagerStub(), makeIoStub(), makeEventLogStub());
    // Two bots both holding more than their share — no shortfalls.
    coord.inventoryByBot.set('Bot1', new Map([['cobblestone', 100], ['oak_planks', 100]]));
    coord.inventoryByBot.set('Bot2', new Map([['cobblestone', 100], ['oak_planks', 100]]));
    const req = new Map<string, number>([['cobblestone', 50], ['oak_planks', 50]]);
    const { plan } = coord.callPlanGather(['Bot1', 'Bot2'], req);
    expect(plan).toHaveLength(0);
  });
});
