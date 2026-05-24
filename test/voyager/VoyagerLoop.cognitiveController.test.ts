/**
 * Project Sid P4-B — Cognitive Controller wiring into VoyagerLoop.
 *
 * These tests verify the FLAG GATING:
 *
 *   1. With `cognition.cognitiveController` OFF, the loop never emits a
 *      Decision (getLastDecision() stays null) and getTalkConditioning()
 *      returns undefined — so the talk modules fall back to getInternalState()
 *      exactly as today. This is the disabled no-op: the old imperative ladder
 *      path is used and nothing structured is produced.
 *   2. With the flag ON, running a cycle records a structured Decision and
 *      getTalkConditioning() returns its conditioningForTalk string. The
 *      selected action.kind matches the ladder (curriculum, for the empty bot).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// fs is touched by SkillLibrary / CurriculumAgent constructors via mkdirSync.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const stub = {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('[]'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
  return { ...actual, default: { ...actual, ...stub }, ...stub };
});

import { VoyagerLoop } from '../../src/voyager/VoyagerLoop';
import type { Config } from '../../src/config';
import type { ThreatAssessment } from '../../src/voyager/ThreatAssessor';
import type { OpportunityScan } from '../../src/voyager/OpportunityDetector';

function makeConfig(cognitiveController: boolean): Config {
  return {
    api: { port: 3001, host: '127.0.0.1' },
    minecraft: { host: 'localhost', port: 25565, version: '1.21', auth: 'offline' },
    bots: { maxBots: 8, defaultMode: 'codegen', joinStaggerMs: 0, reconnectDelaySec: 5, maxReconnectAttempts: 3 },
    behavior: {
      headTrackingRange: 6, headTrackingTickMs: 200, wanderRadius: 8, wanderIntervalMs: 5000,
      ambientChatMinSec: 600, ambientChatMaxSec: 1200, conversationRadius: 6,
    },
    affinity: {
      default: 50, hitPenalty: 10, chatBonus: 2, giftBonus: 5,
      negativeSentimentPenalty: 5, hostileThreshold: 20, trustThreshold: 70,
    },
    instincts: {
      enabled: true, attackCooldownMs: 800, lowHealthThreshold: 6, fleeDistance: 16,
      fightRange: 3, drowningOxygenThreshold: 100, drowningSurfaceClearOxygen: 280,
    },
    voyager: {
      enabled: true, taskCooldownMs: 100, maxRetriesPerTask: 2,
      codeExecutionTimeoutMs: 5000, curriculumLLMCalls: false, criticLLMCalls: false,
    },
    llm: {
      provider: 'gemini', model: 'gemini-2.0-flash', temperature: 0.7,
      chatMaxTokens: 200, codeGenMaxTokens: 1000, maxConcurrentRequests: 1,
    },
    skills: { directory: '/tmp/dyobot-test-skills', maxSkills: 100 },
    logging: { level: 'silent' },
    cognition: { perceptionTick: false, cognitiveController },
  };
}

function makeBot() {
  return {
    inventory: { items: () => [], slots: [] },
    entity: { position: { x: 0, y: 70, z: 0 } },
    entities: {},
    players: {},
    findBlock: vi.fn().mockReturnValue(null),
    findBlocks: vi.fn().mockReturnValue([]),
    blockAt: vi.fn().mockReturnValue({ name: 'grass_block' }),
    time: { timeOfDay: 6000 },
    health: 20,
    food: 20,
    oxygenLevel: 300,
    isRaining: false,
    username: 'TestBot',
    chat: vi.fn(),
  } as any;
}

function makeThreat(level: number): ThreatAssessment {
  return { overallThreatLevel: level, threats: [], suggestedAction: 'none', timestamp: Date.now() };
}
function makeScan(): OpportunityScan {
  return { opportunities: [], timestamp: Date.now(), botPosition: { x: 0, y: 70, z: 0 } };
}

function makeLoop(cognitiveController: boolean) {
  const loop = new VoyagerLoop(makeBot(), 'TestBot', 'farmer', makeConfig(cognitiveController), null);
  loop.setThreatAssessor({ assess: vi.fn(() => makeThreat(2)) } as any);
  loop.setOpportunityDetector({ scan: vi.fn(() => makeScan()) } as any);
  loop.setGoalGenerator({ generateGoals: vi.fn(() => []) } as any);
  (loop as any).proactiveCommunicator = {
    checkAndAnnounce: vi.fn(() => []),
    formatForChat: vi.fn(() => ''),
  };
  return loop;
}

describe('VoyagerLoop P4-B — Cognitive Controller (flag OFF, the disabled no-op)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records NO Decision and getTalkConditioning() is undefined (talk falls back to getInternalState)', async () => {
    const loop = makeLoop(false);
    // Let the curriculum produce a task so the cycle reaches the end of the ladder.
    (loop as any).curriculumAgent.proposeTask = vi.fn(async () => ({ description: 'do something', keywords: [] }));
    // Stop before executing the produced task — we only care that no Decision
    // is recorded along the OFF ladder path.
    (loop as any).executeTaskStep = vi.fn(async () => { throw new Error('stop-cycle'); });

    await (loop as any).runOneCycle().catch(() => { /* stop-cycle sentinel */ });

    expect(loop.getLastDecision()).toBeNull();
    // OFF ⇒ undefined so handleChat/proactive use getInternalState() unchanged.
    expect(loop.getTalkConditioning()).toBeUndefined();
  });
});

describe('VoyagerLoop P4-B — Cognitive Controller (flag ON)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records a structured Decision and broadcasts its conditioningForTalk', async () => {
    const loop = makeLoop(true);
    (loop as any).curriculumAgent.proposeTask = vi.fn(async () => ({ description: 'do something', keywords: [] }));
    (loop as any).executeTaskStep = vi.fn(async () => { throw new Error('stop-cycle'); });

    await (loop as any).runOneCycle().catch(() => { /* stop-cycle sentinel */ });

    const decision = loop.getLastDecision();
    expect(decision).not.toBeNull();
    // Empty bot, non-resident, nothing queued ⇒ curriculum fallback (ladder tail).
    expect(decision!.action.kind).toBe('curriculum');
    // The broadcast string is what handleChat / ProactiveCommunicator consume.
    expect(loop.getTalkConditioning()).toBe(decision!.conditioningForTalk);
    expect(loop.getTalkConditioning()!.length).toBeGreaterThan(0);
  });
});
