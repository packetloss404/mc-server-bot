/**
 * Project Sid P3-A — bot↔bot affinity + conversational sentiment.
 *
 * When `config.social.botAffinity` is enabled, the VoyagerLoop brain-tick
 * message drain (processBotMessage) derives a CHEAP, non-LLM sentiment from
 * each inter-bot message and nudges a directed bot→peer affinity edge through
 * the AffinityManager (real or proxied). It also GATES behavior: a peer below
 * the affinity hostile threshold is deprioritized for help and refused
 * resource sharing — reusing the existing `isHostile` pattern.
 *
 * These tests verify:
 *   1. A positive inter-bot signal nudges the edge up (onPositiveChat).
 *   2. A negative inter-bot signal nudges the edge down (onNegativeSentiment).
 *   3. `isHostile`-driven gating refuses help/resource sharing for a disliked
 *      peer (help task not queued, resource not shared).
 *   4. With the flag OFF, NONE of the above happens — no affinity writes, no
 *      gating, and help/resource requests behave exactly as before.
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

import { VoyagerLoop, AffinityLike } from '../../src/voyager/VoyagerLoop';
import type { Config } from '../../src/config';

function makeConfig(botAffinity: boolean): Config {
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
    social: { botAffinity, culture: false },
  };
}

function makeBot(items: Array<{ name: string; count: number }> = []) {
  return {
    inventory: { items: () => items },
    entity: { position: { x: 0, y: 70, z: 0 } },
    findBlock: vi.fn().mockReturnValue(null),
    blockAt: vi.fn().mockReturnValue({ name: 'grass_block', biome: { name: 'plains' } }),
    time: { timeOfDay: 6000 },
    health: 20,
    food: 20,
    oxygenLevel: 300,
    heldItem: null,
    nearestEntity: vi.fn().mockReturnValue(null),
    isRaining: false,
    username: 'TestBot',
    players: {},
  } as any;
}

/** Fake affinity surface that records write calls and answers isHostile from a set. */
function makeAffinity(hostilePeers: string[] = []): AffinityLike & {
  positive: Array<[string, string]>;
  negative: Array<[string, string]>;
} {
  const hostile = new Set(hostilePeers.map((p) => p.toLowerCase()));
  const positive: Array<[string, string]> = [];
  const negative: Array<[string, string]> = [];
  return {
    positive,
    negative,
    onPositiveChat: (bot: string, name: string) => { positive.push([bot, name]); },
    onNegativeSentiment: (bot: string, name: string) => { negative.push([bot, name]); },
    isHostile: (_bot: string, name: string) => hostile.has(name.toLowerCase()),
    getAllForBot: () => ({}),
  };
}

function makeLoop(botAffinity: boolean, items: Array<{ name: string; count: number }> = []) {
  const loop = new VoyagerLoop(makeBot(items), 'TestBot', 'farmer', makeConfig(botAffinity), null);
  // Stub botComms.sendMessage so the resource-request path doesn't NPE.
  const sent: Array<{ to: string; content: string }> = [];
  (loop as any).botComms = { sendMessage: (_from: string, to: string, content: string) => { sent.push({ to, content }); } };
  return { loop, sent };
}

describe('VoyagerLoop P3-A — bot→bot affinity (flag ON)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('nudges the bot→peer edge UP for a positive inter-bot signal', async () => {
    const { loop } = makeLoop(true);
    const affinity = makeAffinity();
    loop.setAffinityManager(affinity);

    // A 'social' message with positive keywords → analyzeSentiment POSITIVE.
    await (loop as any).processBotMessage({ from: 'Bob', type: 'social', content: 'thanks friend, you are awesome' });

    expect(affinity.positive).toEqual([['TestBot', 'Bob']]);
    expect(affinity.negative).toEqual([]);
  });

  it('nudges the bot→peer edge DOWN for a negative inter-bot signal', async () => {
    const { loop } = makeLoop(true);
    const affinity = makeAffinity();
    loop.setAffinityManager(affinity);

    await (loop as any).processBotMessage({ from: 'Bob', type: 'social', content: 'you are useless and annoying' });

    expect(affinity.negative).toEqual([['TestBot', 'Bob']]);
    expect(affinity.positive).toEqual([]);
  });

  it('treats a help_request as a friendly overture (positive edge) without an LLM call', async () => {
    const { loop } = makeLoop(true);
    const affinity = makeAffinity();
    loop.setAffinityManager(affinity);

    await (loop as any).processBotMessage({ from: 'Bob', type: 'help_request', content: 'come mine with me' });

    expect(affinity.positive).toEqual([['TestBot', 'Bob']]);
  });

  it('gates help: a disliked peer (isHostile) does NOT get its help request queued', async () => {
    const { loop } = makeLoop(true);
    const affinity = makeAffinity(['Bob']); // Bob is below hostile threshold
    loop.setAffinityManager(affinity);

    expect(loop.getQueuedTasks()).toEqual([]);
    await (loop as any).processBotMessage({ from: 'Bob', type: 'help_request', content: 'help me build a wall' });

    // help task suppressed for the disliked peer
    expect(loop.getQueuedTasks()).toEqual([]);
  });

  it('gates resources: a disliked peer is refused even when the item is in inventory', async () => {
    const { loop, sent } = makeLoop(true, [{ name: 'oak_log', count: 16 }]);
    const affinity = makeAffinity(['Bob']);
    loop.setAffinityManager(affinity);

    await (loop as any).processBotMessage({ from: 'Bob', type: 'request', content: 'can you give me some oak' });

    // No "Give ... to Bob" task queued; a refusal message is sent.
    expect(loop.getQueuedTasks()).toEqual([]);
    expect(sent.some((m) => /rather not share/i.test(m.content))).toBe(true);
  });

  it('still HELPS a liked peer: help request queues and resources are offered', async () => {
    const { loop, sent } = makeLoop(true, [{ name: 'oak_log', count: 16 }]);
    const affinity = makeAffinity([]); // nobody hostile
    loop.setAffinityManager(affinity);

    await (loop as any).processBotMessage({ from: 'Bob', type: 'help_request', content: 'help me build a wall' });
    expect(loop.getQueuedTasks()).toContain('help me build a wall');

    await (loop as any).processBotMessage({ from: 'Bob', type: 'request', content: 'can you give me some oak' });
    expect(loop.getQueuedTasks().some((t) => /Give oak to Bob/.test(t))).toBe(true);
    expect(sent.some((m) => /coming to you/i.test(m.content))).toBe(true);
  });
});

describe('VoyagerLoop P3-A — flag OFF is a strict no-op', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes NO affinity edges for any message kind when the flag is off', async () => {
    const { loop } = makeLoop(false);
    const affinity = makeAffinity();
    loop.setAffinityManager(affinity);

    await (loop as any).processBotMessage({ from: 'Bob', type: 'social', content: 'you are awesome friend' });
    await (loop as any).processBotMessage({ from: 'Bob', type: 'social', content: 'you are useless' });
    await (loop as any).processBotMessage({ from: 'Bob', type: 'help_request', content: 'help me' });

    expect(affinity.positive).toEqual([]);
    expect(affinity.negative).toEqual([]);
  });

  it('does NOT gate help/resources when the flag is off, even for an otherwise-hostile peer', async () => {
    const { loop, sent } = makeLoop(false, [{ name: 'oak_log', count: 16 }]);
    const affinity = makeAffinity(['Bob']); // would be hostile IF the flag were on
    loop.setAffinityManager(affinity);

    await (loop as any).processBotMessage({ from: 'Bob', type: 'help_request', content: 'help me build a wall' });
    await (loop as any).processBotMessage({ from: 'Bob', type: 'request', content: 'can you give me some oak' });

    // Legacy behavior: help queues, resource offered — gating never consulted.
    expect(loop.getQueuedTasks()).toContain('help me build a wall');
    expect(loop.getQueuedTasks().some((t) => /Give oak to Bob/.test(t))).toBe(true);
    expect(sent.some((m) => /coming to you/i.test(m.content))).toBe(true);
  });
});
