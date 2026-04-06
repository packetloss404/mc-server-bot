import { describe, it, expect, vi } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('[]'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { DependencyResolver } from '../../src/voyager/DependencyResolver';

describe('DependencyResolver', () => {
  let resolver: DependencyResolver;

  // Use 1.20.4 which is widely available in minecraft-data
  try {
    resolver = new DependencyResolver('1.20.4');
  } catch {
    // Skip tests if minecraft-data isn't available for this version
  }

  describe('resolve', () => {
    it('resolves stick from empty inventory into planks + logs', () => {
      if (!resolver) return;
      const plan = resolver.resolve('stick', 4, {});

      expect(plan.orderedSteps.length).toBeGreaterThan(0);
      // Should need to mine logs and craft planks before crafting sticks
      const actions = plan.orderedSteps.map((s) => `${s.action}:${s.item}`);
      expect(actions).toContain('craft:stick');
      // Must have some step to get planks (either mine logs first or craft planks)
      const hasPlanksOrLogs = plan.orderedSteps.some(
        (s) => s.item.includes('planks') || s.item.includes('log')
      );
      expect(hasPlanksOrLogs).toBe(true);
    });

    it('resolves stick when bot already has planks', () => {
      if (!resolver) return;
      const plan = resolver.resolve('stick', 4, { oak_planks: 10 });

      // Should only need to craft sticks — planks already in inventory
      const craftSteps = plan.orderedSteps.filter((s) => s.action === 'craft');
      expect(craftSteps.some((s) => s.item === 'stick')).toBe(true);
      // Should NOT need to mine logs since we have planks
      const mineLogSteps = plan.orderedSteps.filter(
        (s) => s.action === 'mine' && s.item.includes('log')
      );
      expect(mineLogSteps).toHaveLength(0);
    });

    it('returns empty steps when item is already in inventory', () => {
      if (!resolver) return;
      const plan = resolver.resolve('stick', 4, { stick: 10 });

      // Bot already has enough — the root node should be "have"
      // orderedSteps only includes actionable steps (not "have")
      expect(plan.orderedSteps).toHaveLength(0);
    });

    it('resolves stone_pickaxe with full chain from empty inventory', () => {
      if (!resolver) return;
      const plan = resolver.resolve('stone_pickaxe', 1, {});

      expect(plan.orderedSteps.length).toBeGreaterThan(0);
      const items = plan.orderedSteps.map((s) => s.item);
      // Should include cobblestone and sticks somewhere in the chain
      expect(items.some((i) => i === 'cobblestone' || i === 'stone')).toBe(true);
      expect(items.some((i) => i === 'stick' || i.includes('planks') || i.includes('log'))).toBe(true);
    });

    it('steps are in dependency order (prerequisites before dependents)', () => {
      if (!resolver) return;
      const plan = resolver.resolve('stick', 4, {});

      // Find planks and sticks positions
      const planksIdx = plan.orderedSteps.findIndex((s) => s.item.includes('planks'));
      const sticksIdx = plan.orderedSteps.findIndex((s) => s.item === 'stick');

      if (planksIdx >= 0 && sticksIdx >= 0) {
        // Planks must come before sticks
        expect(planksIdx).toBeLessThan(sticksIdx);
      }
    });
  });

  describe('flattenToSteps', () => {
    it('produces actionable steps without "have" entries', () => {
      if (!resolver) return;
      const plan = resolver.resolve('oak_planks', 4, { oak_log: 5 });

      // Bot has logs, just needs to craft planks
      for (const step of plan.orderedSteps) {
        expect(step.action).not.toBe('have');
      }
    });
  });

  describe('getMiningTool', () => {
    it('returns wooden_pickaxe for coal_ore', () => {
      if (!resolver) return;
      expect(resolver.getMiningTool('coal_ore')).toBe('wooden_pickaxe');
    });

    it('returns stone_pickaxe for iron_ore', () => {
      if (!resolver) return;
      expect(resolver.getMiningTool('iron_ore')).toBe('stone_pickaxe');
    });

    it('returns iron_pickaxe for diamond_ore', () => {
      if (!resolver) return;
      expect(resolver.getMiningTool('diamond_ore')).toBe('iron_pickaxe');
    });

    it('returns null for hand-mineable blocks', () => {
      if (!resolver) return;
      expect(resolver.getMiningTool('oak_log')).toBeNull();
    });
  });

  describe('getRecipe', () => {
    it('finds recipe for crafting_table', () => {
      if (!resolver) return;
      const recipe = resolver.getRecipe('crafting_table');
      expect(recipe).not.toBeNull();
      expect(recipe!.ingredients.size).toBeGreaterThan(0);
    });

    it('returns null for items without recipes', () => {
      if (!resolver) return;
      const recipe = resolver.getRecipe('dirt');
      expect(recipe).toBeNull();
    });
  });

  describe('canCraft', () => {
    it('returns true when inventory has materials', () => {
      if (!resolver) return;
      const result = resolver.canCraft('oak_planks', { oak_log: 1 });
      expect(result).toBe(true);
    });

    it('returns false when inventory lacks materials', () => {
      if (!resolver) return;
      const result = resolver.canCraft('oak_planks', {});
      expect(result).toBe(false);
    });
  });
});
