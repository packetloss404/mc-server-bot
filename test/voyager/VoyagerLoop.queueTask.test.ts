/**
 * Task #70 — regression test for VoyagerLoop.queuePlayerTask().
 *
 * Bug (pre-fix): queuePlayerTask() called decomposeAndQueue() in a
 * fire-and-forget Promise. Decomposition awaits the LLM (60s IPC timeout)
 * before pushing anything onto playerTaskQueue, so for the entire latency
 * window the priority chain at VoyagerLoop.ts line ~671 —
 *
 *     const playerTask = goalTask || this.playerTaskQueue.shift();
 *
 * — saw an empty queue and fell through to curriculumAgent.proposeTask(),
 * starving every POST /api/bots/:name/task call until the LLM round-tripped
 * (and, if the LLM was slow or rate-limited, the user observed
 * `queuedTasks: []` and the curriculum re-proposing iron mining ad nauseam).
 *
 * Fix: queuePlayerTask() now pushes the raw task synchronously and runs
 * decomposition as a *refinement* step that splices the subtasks in place
 * if-and-only-if the raw task is still pending in the queue when the LLM
 * returns. The acceptance criteria are:
 *
 *   1. The queue contains the task immediately (no await needed) — so the
 *      very next VoyagerLoop tick can shift it before falling through to
 *      the curriculum.
 *   2. Order is preserved across batched POSTs.
 *   3. If LLM decomposition fails, the raw task remains queued (no data loss).
 *   4. If decomposition succeeds with >1 subtask AND the raw task is still
 *      pending, the raw task is replaced in place by the subtasks (preserving
 *      queue position relative to other entries).
 *   5. If decomposition completes AFTER the raw task has already been
 *      shifted out for execution, the refine step is a no-op (the bot is
 *      already working on something derived from it; we don't re-queue).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// fs is touched by SkillLibrary / CurriculumAgent constructors via mkdirSync.
// Stub the calls that read/write state so the test stays hermetic.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(false),
      readFileSync: vi.fn().mockReturnValue('[]'),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('[]'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import { VoyagerLoop } from '../../src/voyager/VoyagerLoop';
import type { Config } from '../../src/config';
import type { Task } from '../../src/voyager/CurriculumAgent';

function makeConfig(): Config {
  return {
    api: { port: 3001, host: '127.0.0.1' },
    minecraft: { host: 'localhost', port: 25565, version: '1.21', auth: 'offline' },
    bots: { maxBots: 8, defaultMode: 'codegen', joinStaggerMs: 0, reconnectDelaySec: 5, maxReconnectAttempts: 3 },
    behavior: {
      headTrackingRange: 6, headTrackingTickMs: 200, wanderRadius: 8, wanderIntervalMs: 5000,
      ambientChatMinSec: 600, ambientChatMaxSec: 1200, conversationRadius: 6,
    },
    affinity: {
      default: 0, hitPenalty: -5, chatBonus: 1, giftBonus: 5,
      negativeSentimentPenalty: -2, hostileThreshold: -10, trustThreshold: 10,
    },
    instincts: {
      enabled: true, attackCooldownMs: 800, lowHealthThreshold: 6, fleeDistance: 16,
      fightRange: 3, drowningOxygenThreshold: 100, drowningSurfaceClearOxygen: 280,
    },
    voyager: {
      enabled: true,
      taskCooldownMs: 100,
      maxRetriesPerTask: 2,
      codeExecutionTimeoutMs: 5000,
      curriculumLLMCalls: false, // important — controlled per-test below
      criticLLMCalls: false,
    },
    llm: {
      provider: 'gemini', model: 'gemini-2.0-flash', temperature: 0.7,
      chatMaxTokens: 200, codeGenMaxTokens: 1000, maxConcurrentRequests: 1,
    },
    skills: { directory: '/tmp/dyobot-test-skills', maxSkills: 100 },
    logging: { level: 'silent' },
  };
}

function makeBot() {
  return {
    inventory: { items: () => [] },
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

/** Drain microtasks until either `predicate()` is true or `maxTicks` exhausted. */
async function waitFor(predicate: () => boolean, maxTicks = 50): Promise<void> {
  for (let i = 0; i < maxTicks; i++) {
    if (predicate()) return;
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('VoyagerLoop.queuePlayerTask — Task #70', () => {
  let loop: VoyagerLoop;

  beforeEach(() => {
    vi.clearAllMocks();
    // No LLM client → CurriculumAgent.decomposeTask returns [makeTask(description)]
    // synchronously (via an already-resolved Promise). This isolates the
    // "synchronous-push" guarantee from any LLM behavior.
    loop = new VoyagerLoop(makeBot(), 'TestBot', 'farmer', makeConfig(), null);
  });

  it('pushes the raw task onto playerTaskQueue synchronously (before any await)', () => {
    // Pre-fix this assertion fails: the queue is empty until the awaited
    // LLM decomposition resolves. Post-fix the raw task is pushed inline
    // by queuePlayerTask itself, so getQueuedTasks() reflects it immediately.
    expect(loop.getQueuedTasks()).toEqual([]);

    loop.queuePlayerTask('Mine 8 cobblestone', 'dashboard');

    // No await — must already be visible.
    expect(loop.getQueuedTasks()).toEqual(['Mine 8 cobblestone']);
  });

  it('preserves insertion order across batched POSTs', () => {
    const descriptions = [
      'Mine 8 cobblestone',
      'Craft a stone pickaxe',
      'Mine 3 iron ore',
      'Craft a furnace',
    ];

    for (const desc of descriptions) {
      loop.queuePlayerTask(desc, 'dashboard');
    }

    expect(loop.getQueuedTasks()).toEqual(descriptions);
  });

  it('marks the task with requestedBy so the acknowledgment path can fire', () => {
    loop.queuePlayerTask('Build a small house', 'Alice');
    // Reach into private field to confirm requestedBy survives the sync push.
    // The dashboard never reads this directly, but VoyagerLoop.maybeAcknowledgeTask
    // does at runOneCycle line ~688 — losing it would silently break the
    // personality acknowledgment without breaking the queue length check.
    const queue = (loop as any).playerTaskQueue as Task[];
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ description: 'Build a small house', requestedBy: 'Alice' });
  });

  it('still allows the queue to be drained (shift) as the loop would', () => {
    loop.queuePlayerTask('Task A', 'dashboard');
    loop.queuePlayerTask('Task B', 'dashboard');
    expect(loop.getQueuedTasks()).toEqual(['Task A', 'Task B']);

    const queue = (loop as any).playerTaskQueue as Task[];
    const next = queue.shift();
    expect(next?.description).toBe('Task A');
    expect(loop.getQueuedTasks()).toEqual(['Task B']);
  });

  it('refines a single-entry raw task into ordered subtasks when decomposition yields more', async () => {
    // Inject an LLM-enabled CurriculumAgent stub so decomposeTask returns
    // multiple subtasks. We replace `decomposeTask` on the existing agent
    // instance — that's the seam the production code awaits.
    const agent = (loop as any).curriculumAgent;
    let resolveDecompose: ((tasks: Task[]) => void) | null = null;
    const decomposePromise = new Promise<Task[]>((resolve) => {
      resolveDecompose = resolve;
    });
    vi.spyOn(agent, 'decomposeTask').mockImplementation(() => decomposePromise);

    loop.queuePlayerTask('Mine 8 cobblestone', 'dashboard');

    // Step 1 — synchronously visible BEFORE decomposition resolves.
    expect(loop.getQueuedTasks()).toEqual(['Mine 8 cobblestone']);

    // Step 2 — resolve the decomposition with ordered subtasks.
    const subtasks: Task[] = [
      { description: 'Mine 3 oak logs', keywords: ['mine', 'oak_log'] },
      { description: 'Craft 12 oak planks', keywords: ['craft', 'oak_planks'] },
      { description: 'Craft 1 wooden pickaxe', keywords: ['craft', 'wooden_pickaxe'] },
      { description: 'Mine 8 cobblestone', keywords: ['mine', 'cobblestone'] },
    ];
    resolveDecompose!(subtasks);

    // Step 3 — refinement splices the raw entry with the ordered subtasks
    // *in place* so position relative to other queued items is preserved.
    await waitFor(() => loop.getQueuedTasks().length === 4);
    expect(loop.getQueuedTasks()).toEqual([
      'Mine 3 oak logs',
      'Craft 12 oak planks',
      'Craft 1 wooden pickaxe',
      'Mine 8 cobblestone',
    ]);
  });

  it('does not re-queue subtasks when the raw task has already been shifted off the queue', async () => {
    const agent = (loop as any).curriculumAgent;
    let resolveDecompose: ((tasks: Task[]) => void) | null = null;
    vi.spyOn(agent, 'decomposeTask').mockImplementation(
      () => new Promise<Task[]>((resolve) => { resolveDecompose = resolve; }),
    );

    loop.queuePlayerTask('Mine 8 cobblestone', 'dashboard');
    expect(loop.getQueuedTasks()).toEqual(['Mine 8 cobblestone']);

    // Simulate the loop shifting the task into execution (line 671 in VoyagerLoop.ts).
    const queue = (loop as any).playerTaskQueue as Task[];
    queue.shift();
    expect(loop.getQueuedTasks()).toEqual([]);

    // Resolve decomposition AFTER the raw task left the queue.
    resolveDecompose!([
      { description: 'Mine 3 oak logs', keywords: ['mine', 'oak_log'] },
      { description: 'Mine 8 cobblestone', keywords: ['mine', 'cobblestone'] },
    ]);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // The bot is already working on something derived from the raw task —
    // dumping the subtasks back into the queue would resurrect work the
    // user thought was in-flight. The refinement MUST be a no-op here.
    expect(loop.getQueuedTasks()).toEqual([]);
  });

  it('keeps the raw task when decomposition rejects', async () => {
    const agent = (loop as any).curriculumAgent;
    vi.spyOn(agent, 'decomposeTask').mockRejectedValue(new Error('LLM timeout'));

    loop.queuePlayerTask('Mine 8 cobblestone', 'dashboard');

    // Synchronously visible.
    expect(loop.getQueuedTasks()).toEqual(['Mine 8 cobblestone']);

    // Wait for the rejection to flow through the .catch(...) handler.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // The raw task is still in place — losing it would reproduce the original
    // bug under any LLM failure mode.
    expect(loop.getQueuedTasks()).toEqual(['Mine 8 cobblestone']);
  });

  it('queuePlayerTaskFront prepends synchronously (unchanged behavior)', () => {
    loop.queuePlayerTask('Task B', 'dashboard');
    loop.queuePlayerTaskFront('Task A — urgent', 'dashboard');
    expect(loop.getQueuedTasks()).toEqual(['Task A — urgent', 'Task B']);
  });

  it('clearQueue empties the queue (used by overrideWithSwarmDirective)', () => {
    loop.queuePlayerTask('Task A', 'dashboard');
    loop.queuePlayerTask('Task B', 'dashboard');
    loop.clearQueue();
    expect(loop.getQueuedTasks()).toEqual([]);
  });
});
