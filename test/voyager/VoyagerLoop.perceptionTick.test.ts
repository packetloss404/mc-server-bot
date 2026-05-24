/**
 * Project Sid P4-A — always-on perception tick + AgentState integration.
 *
 * These tests verify the FLAG GATING on VoyagerLoop (the BotInstance timer that
 * drives runPerceptionTick is exercised separately):
 *
 *   1. With `cognition.perceptionTick` OFF, runPerceptionTick() is a no-op —
 *      the assessors are NOT invoked and the AgentState cache stays empty (the
 *      perception substrate is dormant; BotInstance also never starts the
 *      timer in this state).
 *   2. With the flag ON, runPerceptionTick() invokes the assessors and writes
 *      their results into AgentState.
 *   3. With the flag OFF, runOneCycle reads the assessment via the INLINE path
 *      (calls assess()/scan() itself) and never consults the cache — the
 *      disabled path is unchanged.
 *   4. With the flag ON, runOneCycle reads from the cache when fresh and does
 *      NOT call the inline assessors.
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

function makeConfig(perceptionTick: boolean): Config {
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
    cognition: { perceptionTick, cognitiveController: false },
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

/** Stub assessors with spies so we can assert who computed the assessment. */
function makeAssessors() {
  const threatAssessor = { assess: vi.fn(() => makeThreat(2)) } as any;
  const opportunityDetector = { scan: vi.fn(() => makeScan()) } as any;
  const goalGenerator = { generateGoals: vi.fn(() => []) } as any;
  return { threatAssessor, opportunityDetector, goalGenerator };
}

function makeLoop(perceptionTick: boolean) {
  const loop = new VoyagerLoop(makeBot(), 'TestBot', 'farmer', makeConfig(perceptionTick), null);
  const assessors = makeAssessors();
  loop.setThreatAssessor(assessors.threatAssessor);
  loop.setOpportunityDetector(assessors.opportunityDetector);
  loop.setGoalGenerator(assessors.goalGenerator);
  return { loop, assessors };
}

describe('VoyagerLoop P4-A — perception tick (flag OFF, the no-op)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runPerceptionTick is a no-op: assessors not called, AgentState stays empty', () => {
    const { loop, assessors } = makeLoop(false);

    loop.runPerceptionTick();

    expect(assessors.threatAssessor.assess).not.toHaveBeenCalled();
    expect(assessors.opportunityDetector.scan).not.toHaveBeenCalled();
    expect(assessors.goalGenerator.generateGoals).not.toHaveBeenCalled();

    const state = loop.getAgentState();
    expect(state.getThreat()).toBeNull();
    expect(state.getOpportunities()).toBeNull();
    expect(state.getSurvivalGoal()).toBeNull();
  });

  it('runOneCycle takes the INLINE path: it calls the assessors itself and ignores the cache', async () => {
    const { loop, assessors } = makeLoop(false);
    // Wire a ProactiveCommunicator stub so the opportunity scan branch runs.
    (loop as any).proactiveCommunicator = {
      checkAndAnnounce: vi.fn(() => []),
      formatForChat: vi.fn(() => ''),
    };
    // Short-circuit task selection right after the assessor sections so the
    // cycle exits before executing any task (the assessor spies are what we
    // assert; they run before proposeTask). scheduleNext wraps runOneCycle in
    // try/catch in production, so a throw here is harmless — we mirror that.
    (loop as any).curriculumAgent.proposeTask = vi.fn(() => { throw new Error('stop-cycle'); });
    // Seed the cache; the OFF path must NOT read it (it should still call assess/scan).
    loop.getAgentState().setThreat(makeThreat(9));
    loop.getAgentState().setOpportunities(makeScan());

    await (loop as any).runOneCycle().catch(() => { /* stop-cycle sentinel */ });

    // Inline assessors were invoked by runOneCycle (flag OFF ignores the cache).
    expect(assessors.threatAssessor.assess).toHaveBeenCalled();
    expect(assessors.opportunityDetector.scan).toHaveBeenCalled();
  });
});

describe('VoyagerLoop P4-A — perception tick (flag ON)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('runPerceptionTick invokes the assessors and writes AgentState', () => {
    const { loop, assessors } = makeLoop(true);

    loop.runPerceptionTick();

    expect(assessors.threatAssessor.assess).toHaveBeenCalledTimes(1);
    expect(assessors.opportunityDetector.scan).toHaveBeenCalledTimes(1);
    expect(assessors.goalGenerator.generateGoals).toHaveBeenCalledTimes(1);

    const state = loop.getAgentState();
    expect(state.getThreat()?.value.overallThreatLevel).toBe(2);
    expect(state.getOpportunities()).not.toBeNull();
    // No survival/safety override from empty goals → cached value is null but fresh.
    expect(state.getSurvivalGoal()).not.toBeNull();
    expect(state.getSurvivalGoal()?.value).toBeNull();
  });

  it('runOneCycle reads from the fresh cache and does NOT call the inline assessors', async () => {
    const { loop, assessors } = makeLoop(true);
    (loop as any).proactiveCommunicator = {
      checkAndAnnounce: vi.fn(() => []),
      formatForChat: vi.fn(() => ''),
    };
    (loop as any).curriculumAgent.proposeTask = vi.fn(() => { throw new Error('stop-cycle'); });

    // Populate the cache as the perception tick would.
    loop.runPerceptionTick();
    expect(assessors.threatAssessor.assess).toHaveBeenCalledTimes(1);
    expect(assessors.opportunityDetector.scan).toHaveBeenCalledTimes(1);

    // Now run a loop cycle — it should consume the cache, not recompute.
    await (loop as any).runOneCycle().catch(() => { /* stop-cycle sentinel */ });

    expect(assessors.threatAssessor.assess).toHaveBeenCalledTimes(1); // unchanged
    expect(assessors.opportunityDetector.scan).toHaveBeenCalledTimes(1); // unchanged
  });
});
