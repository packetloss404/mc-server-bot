import { describe, it, expect, vi } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { ActionAgent } from '../../src/voyager/ActionAgent';

// Access private method through prototype for testing
function injectNullGuards(code: string): string {
  const agent = new ActionAgent({ generate: vi.fn() } as any, 1000);
  return (agent as any).injectNullGuards(code);
}

describe('ActionAgent.injectNullGuards', () => {
  it('injects null check after bot.findBlock assignment', () => {
    const code = `async function task(bot) {
  const block = bot.findBlock({ matching: b => b.name === "oak_log", maxDistance: 32 });
  const pos = block.position;
  await moveTo(pos.x, pos.y, pos.z);
}`;

    const result = injectNullGuards(code);
    expect(result).toContain('if (!block)');
    expect(result).toContain('Block not found');
  });

  it('injects null check after bot.nearestEntity assignment', () => {
    const code = `async function task(bot) {
  const mob = bot.nearestEntity(e => e.name === "zombie");
  await killMob(mob.name);
}`;

    const result = injectNullGuards(code);
    expect(result).toContain('if (!mob)');
    expect(result).toContain('Entity not found');
  });

  it('does not inject when null check already exists', () => {
    const code = `async function task(bot) {
  const block = bot.findBlock({ matching: b => b.name === "oak_log", maxDistance: 32 });
  if (!block) { console.log("not found"); return; }
  const pos = block.position;
}`;

    const result = injectNullGuards(code);
    // Should only have one null check — the existing one
    const matches = result.match(/if\s*\(\s*!block\s*\)/g);
    expect(matches).toHaveLength(1);
  });

  it('handles await in findBlock call', () => {
    const code = `async function task(bot) {
  const block = await bot.findBlock({ matching: b => b.name === "stone", maxDistance: 16 });
  const pos = block.position;
}`;

    const result = injectNullGuards(code);
    expect(result).toContain('if (!block)');
  });

  it('handles multiple findBlock calls in same function', () => {
    const code = `async function task(bot) {
  const log = bot.findBlock({ matching: b => b.name === "oak_log", maxDistance: 32 });
  await mineBlock("oak_log", 1);
  const stone = bot.findBlock({ matching: b => b.name === "stone", maxDistance: 32 });
  await mineBlock("stone", 1);
}`;

    const result = injectNullGuards(code);
    expect(result).toContain('if (!log)');
    expect(result).toContain('if (!stone)');
  });

  it('preserves code with no findBlock or nearestEntity', () => {
    const code = `async function task(bot) {
  await mineBlock("oak_log", 1);
  await craftItem("oak_planks", 4);
}`;

    const result = injectNullGuards(code);
    expect(result).toBe(code);
  });

  it('handles let declarations as well as const', () => {
    const code = `async function task(bot) {
  let target = bot.findBlock({ matching: b => b.name === "diamond_ore", maxDistance: 64 });
  const pos = target.position;
}`;

    const result = injectNullGuards(code);
    expect(result).toContain('if (!target)');
  });

  it('preserves indentation of the assignment', () => {
    const code = `async function task(bot) {
    const block = bot.findBlock({ matching: b => b.name === "oak_log", maxDistance: 32 });
    const pos = block.position;
}`;

    const result = injectNullGuards(code);
    // The null check should be indented to match the assignment
    expect(result).toContain('    if (!block)');
  });
});
