import { describe, it, expect, vi } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { analyzeFailure, RecoveryHint } from '../../src/voyager/ErrorRecovery';

function createMockBot(inventoryItems: Array<{ name: string; count: number }> = [], findBlockResult: any = null) {
  return {
    inventory: {
      items: () => inventoryItems,
    },
    findBlock: vi.fn().mockReturnValue(findBlockResult),
    entity: { position: { x: 0, y: 70, z: 0 } },
  } as any;
}

describe('ErrorRecovery', () => {
  describe('crafting failures with replaceTask', () => {
    it('returns replaceTask with first missing material for sticks when no planks', () => {
      const bot = createMockBot([]); // empty inventory
      const result = analyzeFailure({
        task: 'Craft 4 sticks',
        error: 'stick was not crafted',
        critique: '',
        code: 'await craftItem("stick", 4);',
        bot,
        attempt: 1,
        maxAttempts: 3,
      });

      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('missing_craft_materials');
      expect(result!.replaceTask).toBe('Obtain oak_planks');
    });

    it('returns replaceTask for wooden_pickaxe when missing planks and sticks', () => {
      const bot = createMockBot([]); // empty inventory
      const result = analyzeFailure({
        task: 'Craft a wooden pickaxe',
        error: 'wooden_pickaxe was not crafted',
        critique: '',
        code: 'await craftItem("wooden_pickaxe", 1);',
        bot,
        attempt: 1,
        maxAttempts: 3,
      });

      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('missing_craft_materials');
      expect(result!.replaceTask).toBe('Obtain oak_planks');
    });

    it('returns replaceTask for sticks when bot has some planks but not enough', () => {
      const bot = createMockBot([{ name: 'oak_planks', count: 1 }]);
      const result = analyzeFailure({
        task: 'Craft 4 sticks',
        error: 'stick was not crafted',
        critique: '',
        code: 'await craftItem("stick", 4);',
        bot,
        attempt: 1,
        maxAttempts: 3,
      });

      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('missing_craft_materials');
      expect(result!.replaceTask).toBe('Obtain oak_planks');
    });

    it('returns no replaceTask when bot has all materials for sticks', () => {
      const bot = createMockBot([{ name: 'oak_planks', count: 4 }]);
      const result = analyzeFailure({
        task: 'Craft 4 sticks',
        error: 'stick was not crafted',
        critique: '',
        code: 'await craftItem("stick", 4);',
        bot,
        attempt: 1,
        maxAttempts: 3,
      });

      expect(result).not.toBeNull();
      // Has all materials — hint says "you HAVE all materials", no replaceTask
      expect(result!.replaceTask).toBeUndefined();
    });

    it('returns replaceTask for stone_pickaxe missing cobblestone', () => {
      const bot = createMockBot([{ name: 'stick', count: 4 }]);
      const result = analyzeFailure({
        task: 'Craft a stone pickaxe',
        error: 'stone_pickaxe was not crafted',
        critique: '',
        code: 'await craftItem("stone_pickaxe", 1);',
        bot,
        attempt: 1,
        maxAttempts: 3,
      });

      expect(result).not.toBeNull();
      expect(result!.replaceTask).toBe('Obtain cobblestone');
    });

    it('counts planks from any wood type for substitution', () => {
      const bot = createMockBot([{ name: 'birch_planks', count: 4 }]);
      const result = analyzeFailure({
        task: 'Craft 4 sticks',
        error: 'stick was not crafted',
        critique: '',
        code: 'await craftItem("stick", 4);',
        bot,
        attempt: 1,
        maxAttempts: 3,
      });

      expect(result).not.toBeNull();
      // birch_planks counts as planks, so bot has enough
      expect(result!.replaceTask).toBeUndefined();
    });
  });

  describe('mining failures with replaceTask', () => {
    it('returns replaceTask to craft stone_pickaxe when mining iron without one', () => {
      const bot = createMockBot([]);
      const result = analyzeFailure({
        task: 'Mine 3 iron_ore',
        error: 'inventory did not gain iron_ore',
        critique: '',
        code: 'await mineBlock("iron_ore", 3);',
        bot,
        attempt: 1,
        maxAttempts: 3,
      });

      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('wrong_tool');
      expect(result!.replaceTask).toBe('Craft a stone_pickaxe');
    });

    it('does not return replaceTask when bot has required pickaxe', () => {
      const bot = createMockBot([{ name: 'stone_pickaxe', count: 1 }]);
      // findBlock returns a block so it doesn't hit target_not_found
      bot.findBlock.mockReturnValue({ name: 'iron_ore', position: { x: 10, y: 20, z: 30 } });

      const result = analyzeFailure({
        task: 'Mine 3 iron_ore',
        error: 'inventory did not gain iron_ore',
        critique: '',
        code: 'await mineBlock("iron_ore", 3);',
        bot,
        attempt: 1,
        maxAttempts: 3,
      });

      // Should not be wrong_tool since we have the pickaxe
      expect(result?.pattern).not.toBe('wrong_tool');
    });
  });

  describe('abandon behavior', () => {
    it('abandons swim-to-surface when bot is already above water', () => {
      const bot = createMockBot([]);
      bot.entity.position.y = 70;
      bot.findBlock.mockReturnValue(null); // no water nearby

      const result = analyzeFailure({
        task: 'Swim to the surface',
        error: 'position did not change',
        critique: '',
        code: '',
        bot,
        attempt: 1,
        maxAttempts: 3,
      });

      expect(result).not.toBeNull();
      expect(result!.abandon).toBe(true);
    });
  });

  describe('null reference errors', () => {
    it('returns null_position hint for position access on null', () => {
      const bot = createMockBot([]);
      const result = analyzeFailure({
        task: 'Mine 1 oak log',
        error: "Cannot read properties of null (reading 'x')",
        critique: '',
        code: 'const block = bot.findBlock(...); const pos = block.position;',
        bot,
        attempt: 1,
        maxAttempts: 3,
      });

      expect(result).not.toBeNull();
      expect(result!.pattern).toBe('null_position');
      expect(result!.hint).toContain('check the result');
    });
  });
});
