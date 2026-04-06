import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface DependencyNode {
  item: string;
  count: number;
  action: 'mine' | 'craft' | 'smelt' | 'gather' | 'have';
  children: DependencyNode[];
  requiresTool?: string;
  requiresStation?: string;
}

export interface ResolvedPlan {
  goal: string;
  root: DependencyNode;
  orderedSteps: FlatStep[];
  totalItemsNeeded: Map<string, number>;
}

export interface FlatStep {
  action: 'mine' | 'craft' | 'smelt' | 'gather';
  item: string;
  count: number;
  requiresTool?: string;
  requiresStation?: string;
}

// ---------------------------------------------------------------------------
// Internal types for minecraft-data recipe parsing
// ---------------------------------------------------------------------------

interface RecipeIngredient {
  id: number;
  count: number;
}

interface ParsedRecipe {
  ingredients: RecipeIngredient[];
  resultCount: number;
  requiresStation: string | null; // 'crafting_table' or null for 2x2
}

// Map of block -> minimum pickaxe tier required
const MINING_TOOL_MAP: Record<string, string> = {
  // Stone tier (wooden pickaxe)
  stone: 'wooden_pickaxe',
  cobblestone: 'wooden_pickaxe',
  coal_ore: 'wooden_pickaxe',
  deepslate_coal_ore: 'wooden_pickaxe',
  sandstone: 'wooden_pickaxe',
  // Iron tier (stone pickaxe)
  iron_ore: 'stone_pickaxe',
  deepslate_iron_ore: 'stone_pickaxe',
  copper_ore: 'stone_pickaxe',
  deepslate_copper_ore: 'stone_pickaxe',
  lapis_ore: 'stone_pickaxe',
  deepslate_lapis_ore: 'stone_pickaxe',
  // Diamond tier (iron pickaxe)
  diamond_ore: 'iron_pickaxe',
  deepslate_diamond_ore: 'iron_pickaxe',
  gold_ore: 'iron_pickaxe',
  deepslate_gold_ore: 'iron_pickaxe',
  redstone_ore: 'iron_pickaxe',
  deepslate_redstone_ore: 'iron_pickaxe',
  emerald_ore: 'iron_pickaxe',
  deepslate_emerald_ore: 'iron_pickaxe',
  // Obsidian (diamond pickaxe)
  obsidian: 'diamond_pickaxe',
  crying_obsidian: 'diamond_pickaxe',
  // Netherite (diamond pickaxe)
  ancient_debris: 'diamond_pickaxe',
};

// Items that are raw-mined from blocks (block name -> item dropped)
const BLOCK_DROP_MAP: Record<string, string> = {
  oak_log: 'oak_log',
  birch_log: 'birch_log',
  spruce_log: 'spruce_log',
  jungle_log: 'jungle_log',
  acacia_log: 'acacia_log',
  dark_oak_log: 'dark_oak_log',
  mangrove_log: 'mangrove_log',
  cherry_log: 'cherry_log',
  coal_ore: 'coal',
  deepslate_coal_ore: 'coal',
  iron_ore: 'raw_iron',
  deepslate_iron_ore: 'raw_iron',
  copper_ore: 'raw_copper',
  deepslate_copper_ore: 'raw_copper',
  gold_ore: 'raw_gold',
  deepslate_gold_ore: 'raw_gold',
  diamond_ore: 'diamond',
  deepslate_diamond_ore: 'diamond',
  lapis_ore: 'lapis_lazuli',
  deepslate_lapis_ore: 'lapis_lazuli',
  redstone_ore: 'redstone',
  deepslate_redstone_ore: 'redstone',
  emerald_ore: 'emerald',
  deepslate_emerald_ore: 'emerald',
  stone: 'cobblestone',
  sand: 'sand',
  gravel: 'gravel',
  clay: 'clay_ball',
  dirt: 'dirt',
};

// Items that come from smelting (output item -> input item)
const SMELT_MAP: Record<string, string> = {
  iron_ingot: 'raw_iron',
  gold_ingot: 'raw_gold',
  copper_ingot: 'raw_copper',
  glass: 'sand',
  stone: 'cobblestone',
  smooth_stone: 'stone',
  brick: 'clay_ball',
  charcoal: 'oak_log',
  netherite_scrap: 'ancient_debris',
};

// Items that are gathered by hand from the world (not mined with a tool, not crafted)
const GATHER_ITEMS = new Set([
  'wheat_seeds', 'beetroot_seeds', 'melon_seeds', 'pumpkin_seeds',
  'sugar_cane', 'bamboo', 'cactus', 'kelp', 'seagrass',
  'sweet_berries', 'glow_berries', 'apple', 'egg',
  'feather', 'string', 'bone', 'gunpowder', 'ender_pearl',
  'blaze_rod', 'ghast_tear', 'slime_ball', 'leather',
  'rabbit_hide', 'phantom_membrane', 'ink_sac', 'glow_ink_sac',
  'nether_wart', 'spider_eye',
]);

// Blocks that are mineable by hand (no tool required)
const HAND_MINEABLE = new Set([
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log',
  'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log',
  'dirt', 'sand', 'gravel', 'clay',
]);

// ---------------------------------------------------------------------------
// DependencyResolver
// ---------------------------------------------------------------------------

export class DependencyResolver {
  private readonly data: any; // minecraft-data IndexedData
  private readonly version: string;

  constructor(version: string) {
    this.version = version;
    const mcData = require('minecraft-data');
    this.data = mcData(version);
    if (!this.data) {
      throw new Error(`minecraft-data: unsupported version "${version}"`);
    }
    logger.debug({ version }, 'DependencyResolver initialised');
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Resolve all dependencies for crafting / obtaining `goalItem`.
   * `inventory` maps item names to counts the bot currently has.
   */
  resolve(
    goalItem: string,
    goalCount: number,
    inventory: Record<string, number>,
  ): ResolvedPlan {
    // Work on a mutable copy so we can subtract as we allocate
    const inv = { ...inventory };
    const visiting = new Set<string>(); // circular-dependency guard
    const root = this.buildNode(goalItem, goalCount, inv, visiting);
    const orderedSteps = this.flattenToSteps(root);
    const totalItemsNeeded = new Map<string, number>();
    for (const step of orderedSteps) {
      totalItemsNeeded.set(
        step.item,
        (totalItemsNeeded.get(step.item) ?? 0) + step.count,
      );
    }
    return { goal: goalItem, root, orderedSteps, totalItemsNeeded };
  }

  /**
   * Flatten a dependency tree into topologically-sorted steps (leaf-first).
   */
  flattenToSteps(root: DependencyNode): FlatStep[] {
    const steps: FlatStep[] = [];
    this.collectSteps(root, steps);
    return steps;
  }

  /**
   * Return the minimum pickaxe tier needed to mine `blockName`, or null if
   * the block is hand-mineable or not in our tool map.
   */
  getMiningTool(blockName: string): string | null {
    return MINING_TOOL_MAP[blockName] ?? null;
  }

  /**
   * Look up a crafting recipe from minecraft-data.
   * Returns parsed ingredients + whether a crafting table is needed, or null.
   */
  getRecipe(itemName: string): { ingredients: Map<string, number>; station: string | null } | null {
    const parsed = this.findRecipe(itemName);
    if (!parsed) return null;
    const ingredients = new Map<string, number>();
    for (const ing of parsed.ingredients) {
      const ingItem = this.data.items[ing.id];
      if (!ingItem) continue;
      ingredients.set(ingItem.name, (ingredients.get(ingItem.name) ?? 0) + ing.count);
    }
    return { ingredients, station: parsed.requiresStation };
  }

  /**
   * Check whether `inventory` contains enough materials to craft `itemName`.
   */
  canCraft(itemName: string, inventory: Record<string, number>): boolean {
    const recipe = this.getRecipe(itemName);
    if (!recipe) return false;
    for (const [name, count] of recipe.ingredients) {
      if ((inventory[name] ?? 0) < count) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Recursively build a DependencyNode tree for the requested item+count.
   * Mutates `inv` to subtract items as they are "claimed".
   */
  private buildNode(
    item: string,
    count: number,
    inv: Record<string, number>,
    visiting: Set<string>,
  ): DependencyNode {
    // 1. Check inventory first
    const have = inv[item] ?? 0;
    if (have >= count) {
      inv[item] = have - count;
      return { item, count, action: 'have', children: [] };
    }
    // Subtract whatever we do have
    const remaining = count - have;
    if (have > 0) inv[item] = 0;

    // 2. Circular-dependency guard
    if (visiting.has(item)) {
      logger.warn({ item }, 'DependencyResolver: circular dependency detected, treating as gather');
      return { item, count: remaining, action: 'gather', children: [] };
    }
    visiting.add(item);

    let node: DependencyNode;

    // 3. Check if it's a smelted product
    const smeltInput = SMELT_MAP[item];
    if (smeltInput) {
      const children: DependencyNode[] = [];
      children.push(this.buildNode(smeltInput, remaining, inv, visiting));
      // Smelting also needs fuel – require 1 coal per item (simplification)
      children.push(this.buildNode('coal', Math.ceil(remaining / 8), inv, visiting));
      node = {
        item,
        count: remaining,
        action: 'smelt',
        children,
        requiresStation: 'furnace',
      };
      visiting.delete(item);
      return node;
    }

    // 4. Check if it has a crafting recipe
    const parsed = this.findRecipe(item);
    if (parsed) {
      const batchesNeeded = Math.ceil(remaining / parsed.resultCount);
      const children: DependencyNode[] = [];
      // Aggregate ingredients across all batches
      const ingredientTotals = new Map<number, number>();
      for (const ing of parsed.ingredients) {
        ingredientTotals.set(
          ing.id,
          (ingredientTotals.get(ing.id) ?? 0) + ing.count * batchesNeeded,
        );
      }
      for (const [id, totalCount] of ingredientTotals) {
        const ingItem = this.data.items[id];
        if (!ingItem) continue;
        children.push(this.buildNode(ingItem.name, totalCount, inv, visiting));
      }
      node = {
        item,
        count: remaining,
        action: 'craft',
        children,
      };
      if (parsed.requiresStation) {
        node.requiresStation = parsed.requiresStation;
      }
      visiting.delete(item);
      return node;
    }

    // 5. Check if it's a minable item
    const blockName = this.findMinableBlock(item);
    if (blockName) {
      const tool = this.getMiningTool(blockName);
      const children: DependencyNode[] = [];
      // If a tool is required, resolve it too
      if (tool) {
        children.push(this.buildNode(tool, 1, inv, visiting));
      }
      node = {
        item,
        count: remaining,
        action: 'mine',
        children,
        requiresTool: tool ?? undefined,
      };
      visiting.delete(item);
      return node;
    }

    // 6. Fallback: gather
    visiting.delete(item);
    return { item, count: remaining, action: 'gather', children: [] };
  }

  /**
   * Depth-first post-order collection of actionable steps (skip 'have' nodes).
   */
  private collectSteps(node: DependencyNode, steps: FlatStep[]): void {
    for (const child of node.children) {
      this.collectSteps(child, steps);
    }
    if (node.action !== 'have') {
      steps.push({
        action: node.action,
        item: node.item,
        count: node.count,
        requiresTool: node.requiresTool,
        requiresStation: node.requiresStation,
      });
    }
  }

  /**
   * Find the best crafting recipe for an item from minecraft-data.
   * Returns null if no recipe exists.
   */
  private findRecipe(itemName: string): ParsedRecipe | null {
    const itemInfo = this.data.itemsByName[itemName];
    if (!itemInfo) return null;

    const recipes: any[] | undefined = this.data.recipes[itemInfo.id];
    if (!recipes || recipes.length === 0) return null;

    // Pick the first recipe (minecraft-data may list several variants)
    const recipe = recipes[0];
    const ingredients: RecipeIngredient[] = [];

    if (recipe.inShape) {
      // Shaped recipe
      const needsTable = this.shapedNeedsTable(recipe.inShape);
      for (const row of recipe.inShape) {
        for (const cell of row) {
          const id = this.extractId(cell);
          if (id == null) continue;
          const existing = ingredients.find((i) => i.id === id);
          if (existing) {
            existing.count += 1;
          } else {
            ingredients.push({ id, count: 1 });
          }
        }
      }
      return {
        ingredients,
        resultCount: this.extractCount(recipe.result),
        requiresStation: needsTable ? 'crafting_table' : null,
      };
    }

    if (recipe.ingredients) {
      // Shapeless recipe
      const needsTable = recipe.ingredients.length > 4;
      for (const ing of recipe.ingredients) {
        const id = this.extractId(ing);
        if (id == null) continue;
        const existing = ingredients.find((i) => i.id === id);
        if (existing) {
          existing.count += 1;
        } else {
          ingredients.push({ id, count: 1 });
        }
      }
      return {
        ingredients,
        resultCount: this.extractCount(recipe.result),
        requiresStation: needsTable ? 'crafting_table' : null,
      };
    }

    return null;
  }

  /**
   * Determine if a shaped recipe's inShape exceeds a 2x2 grid.
   */
  private shapedNeedsTable(inShape: any[][]): boolean {
    if (inShape.length > 2) return true;
    for (const row of inShape) {
      if (row.length > 2) return true;
    }
    return false;
  }

  /**
   * Extract a numeric item ID from the various RecipeItem formats in minecraft-data.
   * Formats: number | null | [id] | [id, metadata] | { id, metadata?, count? }
   */
  private extractId(cell: any): number | null {
    if (cell == null) return null;
    if (typeof cell === 'number') return cell;
    if (Array.isArray(cell)) return cell[0] ?? null;
    if (typeof cell === 'object' && 'id' in cell) return cell.id;
    return null;
  }

  /**
   * Extract the result count from a RecipeItem (defaults to 1).
   */
  private extractCount(result: any): number {
    if (result == null) return 1;
    if (typeof result === 'object' && !Array.isArray(result) && 'count' in result) {
      return result.count ?? 1;
    }
    return 1;
  }

  /**
   * Given an item name, find a block that drops it when mined.
   * Checks BLOCK_DROP_MAP first, then falls back to same-name block.
   */
  private findMinableBlock(itemName: string): string | null {
    // Check if any block in our drop map yields this item
    for (const [block, drop] of Object.entries(BLOCK_DROP_MAP)) {
      if (drop === itemName) return block;
    }
    // Check if a block with the same name exists (e.g. "sand" is both item and block)
    if (this.data.blocksByName[itemName]) {
      return itemName;
    }
    // Check common log/wood patterns
    if (itemName.endsWith('_planks')) {
      const wood = itemName.replace('_planks', '_log');
      if (this.data.blocksByName[wood]) return null; // planks are crafted, not mined
    }
    return null;
  }
}
