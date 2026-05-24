/**
 * ObservedRoleModel unit tests (Project Sid P1-A).
 *
 * Exercises the PURE classifier `inferObservedRole` against hand-built action
 * vectors — no file I/O. Each fixture isolates one dominant signal and asserts
 * the model picks the matching town role, plus the empty-vector idle fallback.
 *
 * The loader (`loadObservedRole`) is deliberately not tested here: it only adds
 * a `stats.json` read on top of this pure function, and the instructions scope
 * tests to the pure path.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  inferObservedRole,
  loadObservedRole,
  IDLE_ROLE,
  type BotActionStats,
} from '../../src/town/ObservedRoleModel';
import { TOWN_ROLES } from '../../src/town/RoleManager';

const EMPTY: BotActionStats = {};

describe('inferObservedRole', () => {
  it('classifies a mining-heavy vector as miner', () => {
    const actions: BotActionStats = {
      mined: { stone: 240, cobblestone: 30, iron_ore: 18, coal_ore: 22, oak_log: 4 },
      crafted: { stone_pickaxe: 1, iron_pickaxe: 1 },
    };
    const { observedRole, scores } = inferObservedRole(actions);
    expect(observedRole).toBe('miner');
    expect(scores.miner).toBeGreaterThan(scores.lumberjack);
    expect(scores.miner).toBeGreaterThan(scores.gatherer);
  });

  it('classifies a kill + combat-craft vector as guard', () => {
    const actions: BotActionStats = {
      killed: { zombie: 6, skeleton: 4, creeper: 2 },
      crafted: { iron_sword: 1, shield: 1, iron_chestplate: 1 },
      // A little incidental mining shouldn't flip the verdict.
      mined: { stone: 8 },
    };
    const { observedRole, scores } = inferObservedRole(actions);
    expect(observedRole).toBe('guard');
    expect(scores.guard).toBeGreaterThan(scores.miner);
    expect(scores.guard).toBeGreaterThan(scores.blacksmith);
  });

  it('classifies a wood vector as lumberjack', () => {
    const actions: BotActionStats = {
      mined: { oak_log: 666, spruce_log: 40, birch_log: 12 },
    };
    const { observedRole, scores } = inferObservedRole(actions);
    expect(observedRole).toBe('lumberjack');
    expect(scores.lumberjack).toBeGreaterThan(scores.miner);
  });

  it('classifies a farming vector as farmer', () => {
    const actions: BotActionStats = {
      mined: { wheat: 80, carrots: 30, potatoes: 20 },
      crafted: { wooden_hoe: 1 },
      placed: { wheat_seeds: 60 },
    };
    const { observedRole } = inferObservedRole(actions);
    expect(observedRole).toBe('farmer');
  });

  it('classifies a smelting vector as blacksmith', () => {
    const actions: BotActionStats = {
      smelted: { raw_iron: 40, raw_gold: 8 },
      crafted: { iron_ingot: 12, iron_pickaxe: 2 },
    };
    const { observedRole, scores } = inferObservedRole(actions);
    expect(observedRole).toBe('blacksmith');
    expect(scores.blacksmith).toBeGreaterThan(scores.miner);
  });

  it('classifies a block-placing vector as builder', () => {
    const actions: BotActionStats = {
      placed: { stone_bricks: 120, oak_planks: 80, glass: 40 },
    };
    const { observedRole } = inferObservedRole(actions);
    expect(observedRole).toBe('builder');
  });

  it('classifies a chest-traffic vector as gatherer', () => {
    const actions: BotActionStats = {
      withdrew: { iron_ingot: 64, coal: 128 },
      deposited: { oak_log: 200, wheat: 64 },
    };
    const { observedRole, scores } = inferObservedRole(actions);
    expect(observedRole).toBe('gatherer');
    expect(scores.gatherer).toBeGreaterThan(0);
  });

  it('returns idle for an empty vector', () => {
    const { observedRole, scores } = inferObservedRole(EMPTY);
    expect(observedRole).toBe(IDLE_ROLE);
    // Every score should be zeroed when there's no signal.
    for (const role of TOWN_ROLES) {
      expect(scores[role]).toBe(0);
    }
  });

  it('returns idle when buckets are present but empty', () => {
    const { observedRole } = inferObservedRole({
      mined: {},
      crafted: {},
      killed: {},
      placed: {},
      smelted: {},
      withdrew: {},
      deposited: {},
    });
    expect(observedRole).toBe(IDLE_ROLE);
  });

  it('always emits a score entry for every town role', () => {
    const { scores } = inferObservedRole({ mined: { oak_log: 5 } });
    for (const role of TOWN_ROLES) {
      expect(scores).toHaveProperty(role);
      expect(typeof scores[role]).toBe('number');
    }
  });
});

describe('loadObservedRole (null-safety paths)', () => {
  const tmpDirs: string[] = [];
  const mkDataDir = (statsJson?: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orm-'));
    tmpDirs.push(dir);
    if (statsJson !== undefined) fs.writeFileSync(path.join(dir, 'stats.json'), statsJson);
    return dir;
  };
  afterEach(() => {
    while (tmpDirs.length) fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  });

  it('returns idle when stats.json is missing', () => {
    expect(loadObservedRole('Greta', mkDataDir()).observedRole).toBe(IDLE_ROLE);
  });

  it('returns idle when stats.json is corrupt', () => {
    expect(loadObservedRole('Greta', mkDataDir('{ not valid json')).observedRole).toBe(IDLE_ROLE);
  });

  it('returns idle when the bot has no row', () => {
    const dir = mkDataDir(JSON.stringify({ Someone: { mined: { stone: 50 } } }));
    expect(loadObservedRole('Greta', dir).observedRole).toBe(IDLE_ROLE);
  });

  it('infers the role from a present row', () => {
    const dir = mkDataDir(JSON.stringify({ Greta: { mined: { stone: 50, iron_ore: 10 } } }));
    expect(loadObservedRole('Greta', dir).observedRole).toBe('miner');
  });
});
