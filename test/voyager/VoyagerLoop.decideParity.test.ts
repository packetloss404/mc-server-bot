/**
 * Project Sid P4-B — Cognitive Controller decide()-parity at the LOOP level.
 *
 * VoyagerLoop.cognitiveController.test.ts already covers the flag gating and the
 * curriculum (empty-bot) tail. The reviewers flagged that the
 * `buildCognitiveContext` arg-mapping for the NON-curriculum branches was
 * untested — specifically that the structured `getLastDecision().action.kind`
 * recorded with the controller ON matches the task source the imperative ladder
 * actually selected.
 *
 * These tests drive a full `runOneCycle` with each higher-priority task source
 * wired in turn (long_term_goal, player_task, blackboard) and assert the
 * recorded decision kind. The decision is recorded BEFORE executeTaskStep runs,
 * so we stub executeTaskStep to a no-op sentinel and only inspect the decision.
 *
 * (We construct a real VoyagerLoop rather than the Object.create harness because
 * runOneCycle reads many fields the constructor initialises; the
 * cognitiveController test already proves this construction path works with the
 * fs mock below.)
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
import { makeLongTermGoal } from '../../src/voyager/LongTermGoal';

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

/** Build a controller-ON loop and stub executeTaskStep to stop after the decision is recorded. */
function makeLoop() {
  const loop = new VoyagerLoop(makeBot(), 'TestBot', 'farmer', makeConfig(true), null);
  loop.setThreatAssessor({ assess: vi.fn(() => makeThreat(2)) } as any);
  loop.setOpportunityDetector({ scan: vi.fn(() => makeScan()) } as any);
  loop.setGoalGenerator({ generateGoals: vi.fn(() => []) } as any);
  (loop as any).proactiveCommunicator = {
    checkAndAnnounce: vi.fn(() => []),
    formatForChat: vi.fn(() => ''),
  };
  // Decision is recorded before executeTaskStep; throwing here just halts the
  // cycle early without affecting the already-recorded decision.
  (loop as any).executeTaskStep = vi.fn(async () => { throw new Error('stop-cycle'); });
  return loop;
}

async function runCycle(loop: VoyagerLoop) {
  await (loop as any).runOneCycle().catch(() => { /* stop-cycle sentinel */ });
}

describe('VoyagerLoop P4-B — decide() parity across non-curriculum branches (flag ON)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records action.kind = long_term_goal when an active (non-build) long-term goal owns the cycle', async () => {
    const loop = makeLoop();
    // gather_resource (NOT build_structure) so it flows through the normal
    // ladder rather than the runBuildGoalCycle early return.
    const goal = makeLongTermGoal('gather 32 oak logs', 'Steve', [
      { description: 'chop oak logs', keywords: ['oak', 'log', 'chop'] },
    ]);
    expect(goal.spec.kind).toBe('gather_resource');
    (loop as any).activeLongTermGoal = goal;

    await runCycle(loop);

    const decision = loop.getLastDecision();
    expect(decision).not.toBeNull();
    expect(decision!.action.kind).toBe('long_term_goal');
    expect(decision!.action.task).toBe('chop oak logs');
  });

  it('records action.kind = player_task when a player-queued task is the highest priority', async () => {
    const loop = makeLoop();
    // No long-term goal ⇒ playerTask is a genuine player-queue request.
    (loop as any).playerTaskQueue = [{ description: 'mine some coal', keywords: ['mine', 'coal'], requestedBy: 'Alex' }];

    await runCycle(loop);

    const decision = loop.getLastDecision();
    expect(decision).not.toBeNull();
    expect(decision!.action.kind).toBe('player_task');
    expect(decision!.action.task).toBe('mine some coal');
  });

  it('records action.kind = blackboard when a claimed blackboard task is the highest priority', async () => {
    const loop = makeLoop();
    // Minimal BlackboardManager surface the loop touches this cycle.
    const blackboard = {
      releaseStale: vi.fn(),
      claimBestTask: vi.fn(() => ({ description: 'build the town wall', keywords: ['build', 'wall'] })),
      blockTask: vi.fn(),
      completeTask: vi.fn(),
      postMessage: vi.fn(),
    };
    (loop as any).setBlackboardManager(blackboard as any);

    await runCycle(loop);

    expect(blackboard.claimBestTask).toHaveBeenCalled();
    const decision = loop.getLastDecision();
    expect(decision).not.toBeNull();
    expect(decision!.action.kind).toBe('blackboard');
    expect(decision!.action.task).toBe('build the town wall');
  });
});
