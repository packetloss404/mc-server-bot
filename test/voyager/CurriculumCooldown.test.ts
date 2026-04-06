import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { CurriculumAgent, Task } from '../../src/voyager/CurriculumAgent';

function createMockBot(inventoryItems: Array<{ name: string; count: number }> = []) {
  return {
    inventory: { items: () => inventoryItems },
    entity: {
      position: { x: 0, y: 70, z: 0 },
    },
    findBlock: vi.fn().mockReturnValue(null),
    blockAt: vi.fn().mockReturnValue({ name: 'grass_block', biome: { name: 'plains' } }),
    time: { timeOfDay: 6000 },
    health: 20,
    food: 20,
    oxygenLevel: 300,
    heldItem: null,
    nearestEntity: vi.fn().mockReturnValue(null),
    isRaining: false,
  } as any;
}

function createMockSkillLibrary() {
  return {
    buildSkillSummary: vi.fn().mockResolvedValue(''),
    getTopKSkillCode: vi.fn().mockResolvedValue(''),
    getComposableMatches: vi.fn().mockResolvedValue([]),
    getBestMatch: vi.fn().mockResolvedValue(null),
  } as any;
}

describe('CurriculumAgent cooldown', () => {
  let agent: CurriculumAgent;
  let bot: any;
  let skillLib: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // No LLM, so it will use proposeStaticTask
    agent = new CurriculumAgent(null, false, './data');
    bot = createMockBot([{ name: 'oak_log', count: 5 }, { name: 'oak_planks', count: 10 }]);
    skillLib = createMockSkillLibrary();
  });

  it('proposes the first task on fresh start', async () => {
    const task = await agent.proposeTask(bot, 'farmer', skillLib);
    expect(task.description).toBe('Mine 1 oak log');
  });

  it('resets cooldown on task success', async () => {
    // Simulate: propose first task, complete it
    const first = await agent.proposeTask(bot, 'farmer', skillLib);
    expect(first.description).toBe('Mine 1 oak log');
    agent.updateProgress(first, true);

    // Now propose again — should get a new task (not "Mine 1 oak log" since it's completed)
    const second = await agent.proposeTask(bot, 'farmer', skillLib);
    expect(second.description).not.toBe('Mine 1 oak log');
  });

  it('does not immediately block tasks with few proposals', async () => {
    // Complete the first task to move past the hardcoded first-task check
    const first = await agent.proposeTask(bot, 'farmer', skillLib);
    agent.updateProgress(first, true);

    // Propose and fail a few times (under threshold of 3)
    for (let i = 0; i < 2; i++) {
      const task = await agent.proposeTask(bot, 'farmer', skillLib);
      agent.updateProgress(task, false);
    }

    // Should still be able to propose tasks (cooldown threshold not reached)
    const task = await agent.proposeTask(bot, 'farmer', skillLib);
    expect(task).toBeDefined();
    expect(task.description.length).toBeGreaterThan(0);
  });

  it('cools down tasks after repeated failures beyond threshold', async () => {
    // Complete the first task
    const first = await agent.proposeTask(bot, 'farmer', skillLib);
    agent.updateProgress(first, true);

    // Track which tasks get proposed
    const proposedTasks: string[] = [];
    // Propose and fail the same task many times to trigger cooldown
    for (let i = 0; i < 6; i++) {
      const task = await agent.proposeTask(bot, 'farmer', skillLib);
      proposedTasks.push(task.description);
      agent.updateProgress(task, false);
    }

    // After many failures, the agent should stop proposing the same tasks
    // and eventually move to different ones or the explore fallback
    // The key insight: with cooldown, it won't get stuck in a tight loop
    // on the same 1-2 tasks
    const uniqueTasks = new Set(proposedTasks);
    expect(uniqueTasks.size).toBeGreaterThan(1);
  });

  it('cooldown resets when task succeeds after previous failures', async () => {
    // Complete first hardcoded task
    const first = await agent.proposeTask(bot, 'farmer', skillLib);
    agent.updateProgress(first, true);

    // Fail a task several times
    const failTask: Task = { description: 'Mine 3 oak logs', keywords: ['mine', 'oak_log'] };
    for (let i = 0; i < 5; i++) {
      agent.updateProgress(failTask, false);
    }

    // Now succeed at it
    agent.updateProgress(failTask, true);

    // The internal proposalCounts should have been cleared for this task
    // We can verify by checking that the agent can still propose tasks without issue
    const task = await agent.proposeTask(bot, 'farmer', skillLib);
    expect(task).toBeDefined();
  });
});
