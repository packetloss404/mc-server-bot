import { Bot } from 'mineflayer';
import { Task } from './CurriculumAgent';

export interface ProgressionState {
  hasWood: boolean;
  hasCraftingTable: boolean;
  hasWoodenPickaxe: boolean;
  hasWoodenHoe: boolean;
  hasCobblestone: boolean;
  canMineStoneTier: boolean;
  canFarm: boolean;
}

export function getProgressionState(bot: Bot, completedTasks: string[]): ProgressionState {
  const items = new Set(bot.inventory.items().map((item) => item.name));
  const completed = new Set(completedTasks);
  const hasWood = items.has('oak_log') || items.has('spruce_log') || completed.has('Mine 1 oak log') || completed.has('Mine 3 oak logs');
  const hasCraftingTable = items.has('crafting_table') || completed.has('Craft a crafting table');
  const hasWoodenPickaxe = items.has('wooden_pickaxe') || completed.has('Craft a wooden pickaxe');
  const hasWoodenHoe = items.has('wooden_hoe') || completed.has('Craft a wooden hoe');
  const hasCobblestone = items.has('cobblestone') || completed.has('Mine 3 cobblestone');
  return {
    hasWood,
    hasCraftingTable,
    hasWoodenPickaxe,
    hasWoodenHoe,
    hasCobblestone,
    canMineStoneTier: hasWoodenPickaxe || hasCobblestone,
    canFarm: hasWood && (hasWoodenHoe || hasCraftingTable),
  };
}

export function taskMatchesProgression(task: Task, progression: ProgressionState): boolean {
  const spec = task.spec;
  if (!spec) return true;
  if (spec.target === 'wooden_hoe') return progression.hasWood;
  if (spec.target === 'wooden_pickaxe') return progression.hasWood;
  if (spec.target === 'iron_ore') return progression.hasWoodenPickaxe;
  if (spec.target === 'farmland') return progression.hasWood;
  if (spec.target === 'wheat_seeds') return progression.canFarm || progression.hasWood;
  return true;
}
