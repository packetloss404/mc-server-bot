import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoalPriority = 'survival' | 'safety' | 'obligation' | 'social' | 'role' | 'growth' | 'creative';

export interface Goal {
  id: string;
  priority: GoalPriority;
  urgency: number;       // 0-10, used for sorting within same priority
  description: string;
  keywords: string[];
  source: string;        // what triggered this goal
  expiresAt?: number;    // optional TTL (epoch ms)
}

export interface GoalGeneratorState {
  health: number;
  food: number;
  oxygen: number;
  inventory: Record<string, number>;
  equipment: {
    helmet?: string;
    chestplate?: string;
    leggings?: string;
    boots?: string;
    mainHand?: string;
    offHand?: string;
  };
  nearbyHostiles: { count: number; closestDistance: number };
  timeOfDay: number;       // 0-24000 Minecraft ticks
  isRaining: boolean;
  hasShelter: boolean;
  playerTasks: string[];
  blackboardTasks: string[];
  completedTaskCount: number;
  personality: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ordered from highest to lowest priority. Index is used for sorting. */
const PRIORITY_ORDER: GoalPriority[] = [
  'survival',
  'safety',
  'obligation',
  'social',
  'role',
  'growth',
  'creative',
];

const HOSTILE_MOB_NAMES = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'witch',
  'slime', 'pillager', 'drowned', 'husk', 'enderman',
]);

/** Night in Minecraft starts at tick 13000 and ends at 23000. */
const NIGHT_START = 13000;
const NIGHT_END = 23000;

// ---------------------------------------------------------------------------
// Personality role-goal pools
// ---------------------------------------------------------------------------

interface RoleGoalTemplate {
  description: string;
  keywords: string[];
  urgency: number;
}

const PERSONALITY_ROLE_GOALS: Record<string, RoleGoalTemplate[]> = {
  farmer: [
    { description: 'Plant wheat seeds on nearby farmland', keywords: ['plant', 'wheat', 'farm'], urgency: 7 },
    { description: 'Harvest mature crops', keywords: ['harvest', 'wheat', 'farm', 'crops'], urgency: 6 },
    { description: 'Breed 2 cows or pigs', keywords: ['breed', 'animals', 'farm'], urgency: 5 },
    { description: 'Expand the farm area by tilling more soil', keywords: ['till', 'hoe', 'farmland', 'farm'], urgency: 4 },
    { description: 'Craft bread from harvested wheat', keywords: ['craft', 'bread', 'food'], urgency: 5 },
    { description: 'Build a fenced animal pen', keywords: ['build', 'fence', 'farm', 'pen'], urgency: 3 },
  ],
  guard: [
    { description: 'Patrol a 50-block perimeter around base', keywords: ['patrol', 'guard', 'perimeter'], urgency: 7 },
    { description: 'Clear nearby hostile mobs', keywords: ['kill', 'combat', 'hostile', 'guard'], urgency: 8 },
    { description: 'Build a cobblestone wall section', keywords: ['build', 'wall', 'guard', 'defense'], urgency: 4 },
    { description: 'Craft a stone sword', keywords: ['craft', 'sword', 'weapon', 'combat'], urgency: 6 },
    { description: 'Craft a shield', keywords: ['craft', 'shield', 'defense'], urgency: 5 },
    { description: 'Light the area with torches to prevent mob spawns', keywords: ['place', 'torch', 'light', 'guard'], urgency: 5 },
  ],
  explorer: [
    { description: 'Explore 100 blocks in a new direction', keywords: ['explore', 'walk', 'discover'], urgency: 7 },
    { description: 'Find and enter a cave system', keywords: ['explore', 'cave', 'underground'], urgency: 6 },
    { description: 'Locate a village or structure', keywords: ['explore', 'village', 'structure'], urgency: 5 },
    { description: 'Map surrounding biomes', keywords: ['explore', 'biome', 'map'], urgency: 4 },
    { description: 'Climb to a high point and survey the area', keywords: ['explore', 'climb', 'survey'], urgency: 3 },
    { description: 'Craft a boat for water exploration', keywords: ['craft', 'boat', 'explore'], urgency: 4 },
  ],
  blacksmith: [
    { description: 'Mine 5 iron ore', keywords: ['mine', 'iron_ore', 'resource'], urgency: 7 },
    { description: 'Smelt raw iron into iron ingots', keywords: ['smelt', 'iron', 'furnace'], urgency: 6 },
    { description: 'Craft an iron pickaxe', keywords: ['craft', 'iron_pickaxe', 'tool'], urgency: 6 },
    { description: 'Craft iron armor pieces', keywords: ['craft', 'iron', 'armor'], urgency: 5 },
    { description: 'Mine 3 coal ore for fuel', keywords: ['mine', 'coal_ore', 'fuel'], urgency: 5 },
    { description: 'Craft an anvil', keywords: ['craft', 'anvil', 'repair'], urgency: 3 },
  ],
  merchant: [
    { description: 'Organize items into nearby chests', keywords: ['organize', 'chest', 'storage'], urgency: 6 },
    { description: 'Locate and trade with a villager', keywords: ['trade', 'villager', 'merchant'], urgency: 7 },
    { description: 'Collect diverse items from the environment', keywords: ['collect', 'items', 'diverse'], urgency: 5 },
    { description: 'Craft a chest for storage', keywords: ['craft', 'chest', 'storage'], urgency: 5 },
    { description: 'Sort inventory and drop junk items', keywords: ['sort', 'inventory', 'cleanup'], urgency: 4 },
    { description: 'Set up a trading post area', keywords: ['build', 'trade', 'merchant', 'post'], urgency: 3 },
  ],
  elder: [
    { description: 'Craft an enchanting table', keywords: ['craft', 'enchanting_table', 'enchant'], urgency: 6 },
    { description: 'Brew a healing potion', keywords: ['brew', 'potion', 'healing'], urgency: 5 },
    { description: 'Build a library with bookshelves', keywords: ['build', 'bookshelf', 'library'], urgency: 4 },
    { description: 'Mine diamonds for enchanting', keywords: ['mine', 'diamond_ore', 'resource'], urgency: 7 },
    { description: 'Craft bookshelves for enchanting power', keywords: ['craft', 'bookshelf', 'enchant'], urgency: 5 },
    { description: 'Enchant a tool or weapon', keywords: ['enchant', 'tool', 'weapon'], urgency: 6 },
  ],
};

// ---------------------------------------------------------------------------
// Growth goal templates based on progression tiers
// ---------------------------------------------------------------------------

interface GrowthTier {
  minCompleted: number;
  goals: RoleGoalTemplate[];
}

const GROWTH_TIERS: GrowthTier[] = [
  {
    minCompleted: 0,
    goals: [
      { description: 'Mine 3 oak logs to get started', keywords: ['mine', 'oak_log', 'wood'], urgency: 8 },
      { description: 'Craft a crafting table', keywords: ['craft', 'crafting_table'], urgency: 7 },
      { description: 'Craft wooden tools', keywords: ['craft', 'wooden_pickaxe', 'tool'], urgency: 6 },
    ],
  },
  {
    minCompleted: 5,
    goals: [
      { description: 'Mine cobblestone and craft stone tools', keywords: ['mine', 'cobblestone', 'craft', 'stone_pickaxe'], urgency: 7 },
      { description: 'Craft a furnace for smelting', keywords: ['craft', 'furnace', 'smelt'], urgency: 6 },
      { description: 'Find and mine coal ore', keywords: ['mine', 'coal_ore', 'resource'], urgency: 5 },
    ],
  },
  {
    minCompleted: 15,
    goals: [
      { description: 'Mine iron ore and smelt iron ingots', keywords: ['mine', 'iron_ore', 'smelt', 'iron'], urgency: 7 },
      { description: 'Craft iron tools and armor', keywords: ['craft', 'iron_pickaxe', 'iron', 'tool'], urgency: 6 },
      { description: 'Explore a cave for rare resources', keywords: ['explore', 'cave', 'resource'], urgency: 5 },
    ],
  },
  {
    minCompleted: 30,
    goals: [
      { description: 'Mine diamonds', keywords: ['mine', 'diamond_ore', 'diamond'], urgency: 7 },
      { description: 'Craft diamond tools', keywords: ['craft', 'diamond_pickaxe', 'diamond'], urgency: 6 },
      { description: 'Build a proper shelter or base', keywords: ['build', 'shelter', 'base'], urgency: 5 },
      { description: 'Set up an enchanting area', keywords: ['craft', 'enchanting_table', 'bookshelf'], urgency: 4 },
    ],
  },
  {
    minCompleted: 50,
    goals: [
      { description: 'Prepare for Nether exploration', keywords: ['craft', 'obsidian', 'nether', 'portal'], urgency: 6 },
      { description: 'Brew useful potions', keywords: ['brew', 'potion', 'nether'], urgency: 5 },
      { description: 'Automate a farm with redstone', keywords: ['redstone', 'farm', 'automate'], urgency: 4 },
    ],
  },
];

// ---------------------------------------------------------------------------
// GoalGenerator
// ---------------------------------------------------------------------------

let goalCounter = 0;

function nextGoalId(priority: GoalPriority): string {
  goalCounter += 1;
  return `goal-${priority}-${Date.now()}-${goalCounter}`;
}

export class GoalGenerator {
  private personality: string;

  constructor(personality: string) {
    this.personality = personality.toLowerCase();
  }

  /**
   * Evaluate all inputs and return a sorted Goal[] (highest priority first,
   * then by descending urgency within the same priority tier).
   */
  generateGoals(state: GoalGeneratorState): Goal[] {
    const goals: Goal[] = [];

    // 1. Survival goals — pure state thresholds, no LLM
    this.addSurvivalGoals(state, goals);

    // 2. Safety goals — hostiles + time of day
    this.addSafetyGoals(state, goals);

    // 3. Obligation goals — player-assigned tasks and blackboard
    this.addObligationGoals(state, goals);

    // 4. Social goals (placeholder — real social triggers come from message bus)
    this.addSocialGoals(state, goals);

    // 5. Role goals — personality-specific
    this.addRoleGoals(state, goals);

    // 6. Growth goals — tech-tree progression
    this.addGrowthGoals(state, goals);

    // 7. Creative goals
    this.addCreativeGoals(state, goals);

    // Sort: priority tier first (lower index = higher priority), then urgency descending
    goals.sort((a, b) => {
      const pa = PRIORITY_ORDER.indexOf(a.priority);
      const pb = PRIORITY_ORDER.indexOf(b.priority);
      if (pa !== pb) return pa - pb;
      return b.urgency - a.urgency;
    });

    logger.debug({ count: goals.length, top: goals[0]?.description }, 'GoalGenerator produced goals');
    return goals;
  }

  // -----------------------------------------------------------------------
  // Survival (priority 1) — no LLM, pure thresholds
  // -----------------------------------------------------------------------

  private addSurvivalGoals(state: GoalGeneratorState, goals: Goal[]): void {
    if (state.health < 6) {
      const urgency = state.health <= 2 ? 10 : 8;
      // Check if we have food to eat
      const hasFood = this.hasEdibleFood(state.inventory);
      if (hasFood) {
        goals.push({
          id: nextGoalId('survival'),
          priority: 'survival',
          urgency,
          description: 'Eat food to restore health',
          keywords: ['eat', 'food', 'health', 'survival'],
          source: `health critically low (${state.health}/20)`,
        });
      } else {
        goals.push({
          id: nextGoalId('survival'),
          priority: 'survival',
          urgency,
          description: 'Find and eat food urgently — health is critical',
          keywords: ['find', 'food', 'eat', 'health', 'survival'],
          source: `health critically low (${state.health}/20) and no food`,
        });
      }
    }

    if (state.food < 4) {
      const urgency = state.food <= 1 ? 10 : 7;
      const hasFood = this.hasEdibleFood(state.inventory);
      if (hasFood) {
        goals.push({
          id: nextGoalId('survival'),
          priority: 'survival',
          urgency,
          description: 'Eat food to restore hunger',
          keywords: ['eat', 'food', 'hunger', 'survival'],
          source: `hunger critically low (${state.food}/20)`,
        });
      } else {
        goals.push({
          id: nextGoalId('survival'),
          priority: 'survival',
          urgency,
          description: 'Find food immediately — starving',
          keywords: ['find', 'food', 'hunger', 'survival'],
          source: `hunger critically low (${state.food}/20)`,
        });
      }
    }

    // Drowning: oxygen below 100 out of 300 max — but only if actually in danger
    if (state.oxygen < 100 && state.health < 20) {
      goals.push({
        id: nextGoalId('survival'),
        priority: 'survival',
        urgency: 10,
        description: 'Swim to shore — drowning and taking damage',
        keywords: ['swim', 'shore', 'land', 'walk', 'oxygen', 'survival'],
        source: `oxygen low (${state.oxygen}), health ${state.health}`,
      });
    } else if (state.oxygen < 50) {
      // Low oxygen but no damage yet — swim to shore, not just surface
      goals.push({
        id: nextGoalId('survival'),
        priority: 'survival',
        urgency: 8,
        description: 'Walk to the nearest shore or land — in water',
        keywords: ['walk', 'shore', 'land', 'movement', 'survival'],
        source: `in water, oxygen ${state.oxygen}`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Safety (priority 2) — hostiles + night
  // -----------------------------------------------------------------------

  private addSafetyGoals(state: GoalGeneratorState, goals: Goal[]): void {
    if (state.nearbyHostiles.count > 0) {
      const close = state.nearbyHostiles.closestDistance;
      // Very close hostile = higher urgency
      const urgency = close < 6 ? 9 : close < 12 ? 7 : 5;
      const hasSword = Object.keys(state.inventory).some((n) => n.includes('sword'));

      if (hasSword && close < 12) {
        goals.push({
          id: nextGoalId('safety'),
          priority: 'safety',
          urgency,
          description: `Fight ${state.nearbyHostiles.count} nearby hostile mob(s)`,
          keywords: ['fight', 'combat', 'hostile', 'safety'],
          source: `${state.nearbyHostiles.count} hostile(s) within ${Math.round(close)}m`,
        });
      } else {
        goals.push({
          id: nextGoalId('safety'),
          priority: 'safety',
          urgency,
          description: 'Flee from nearby hostile mobs',
          keywords: ['flee', 'run', 'hostile', 'safety'],
          source: `${state.nearbyHostiles.count} hostile(s) within ${Math.round(close)}m`,
        });
      }
    }

    const isNight = state.timeOfDay >= NIGHT_START && state.timeOfDay < NIGHT_END;
    if (isNight && !state.hasShelter) {
      goals.push({
        id: nextGoalId('safety'),
        priority: 'safety',
        urgency: 6,
        description: 'Find or build shelter — it is nighttime',
        keywords: ['shelter', 'build', 'night', 'safety'],
        source: 'nighttime without shelter',
      });
    }

    // Rain at night without shelter is extra dangerous
    if (isNight && state.isRaining && !state.hasShelter) {
      goals.push({
        id: nextGoalId('safety'),
        priority: 'safety',
        urgency: 7,
        description: 'Seek shelter urgently — rainy night',
        keywords: ['shelter', 'rain', 'night', 'safety'],
        source: 'rainy night without shelter',
      });
    }
  }

  // -----------------------------------------------------------------------
  // Obligation (priority 3) — player tasks + blackboard
  // -----------------------------------------------------------------------

  private addObligationGoals(state: GoalGeneratorState, goals: Goal[]): void {
    // Player-assigned tasks get highest obligation urgency
    for (let i = 0; i < state.playerTasks.length; i++) {
      const desc = state.playerTasks[i];
      goals.push({
        id: nextGoalId('obligation'),
        priority: 'obligation',
        urgency: Math.max(10 - i, 5), // first task = 10, decreasing
        description: desc,
        keywords: this.extractKeywords(desc),
        source: 'player-assigned task',
      });
    }

    // Blackboard tasks get slightly lower urgency
    for (let i = 0; i < state.blackboardTasks.length; i++) {
      const desc = state.blackboardTasks[i];
      goals.push({
        id: nextGoalId('obligation'),
        priority: 'obligation',
        urgency: Math.max(7 - i, 3),
        description: desc,
        keywords: this.extractKeywords(desc),
        source: 'blackboard task',
      });
    }
  }

  // -----------------------------------------------------------------------
  // Social (priority 4)
  // -----------------------------------------------------------------------

  private addSocialGoals(_state: GoalGeneratorState, _goals: Goal[]): void {
    // Social goals are typically injected externally (trade requests, help
    // requests from other bots). This is a stub for future integration.
    // When the social message bus fires events, callers should inject them
    // into the state or append goals after generation.
  }

  // -----------------------------------------------------------------------
  // Role (priority 5) — personality-specific
  // -----------------------------------------------------------------------

  private addRoleGoals(state: GoalGeneratorState, goals: Goal[]): void {
    const pool = PERSONALITY_ROLE_GOALS[state.personality || this.personality];
    if (!pool) {
      // Unknown personality — use a generic explore fallback
      goals.push({
        id: nextGoalId('role'),
        priority: 'role',
        urgency: 4,
        description: 'Explore the surrounding area',
        keywords: ['explore', 'walk', 'discover'],
        source: `role:${state.personality || this.personality}`,
      });
      return;
    }

    for (const template of pool) {
      goals.push({
        id: nextGoalId('role'),
        priority: 'role',
        urgency: template.urgency,
        description: template.description,
        keywords: [...template.keywords],
        source: `role:${state.personality || this.personality}`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Growth (priority 6) — tech-tree progression
  // -----------------------------------------------------------------------

  private addGrowthGoals(state: GoalGeneratorState, goals: Goal[]): void {
    // Find the highest applicable tier
    let applicableTier: GrowthTier | undefined;
    for (let i = GROWTH_TIERS.length - 1; i >= 0; i--) {
      if (state.completedTaskCount >= GROWTH_TIERS[i].minCompleted) {
        applicableTier = GROWTH_TIERS[i];
        break;
      }
    }

    if (!applicableTier) {
      applicableTier = GROWTH_TIERS[0];
    }

    for (const template of applicableTier.goals) {
      goals.push({
        id: nextGoalId('growth'),
        priority: 'growth',
        urgency: template.urgency,
        description: template.description,
        keywords: [...template.keywords],
        source: `growth:tier-${applicableTier.minCompleted}`,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Creative (priority 7)
  // -----------------------------------------------------------------------

  private addCreativeGoals(state: GoalGeneratorState, goals: Goal[]): void {
    // Creative goals only surface after meaningful progression
    if (state.completedTaskCount < 20) return;

    goals.push({
      id: nextGoalId('creative'),
      priority: 'creative',
      urgency: 3,
      description: 'Build a decorative structure',
      keywords: ['build', 'creative', 'decorate'],
      source: 'creative-impulse',
    });

    if (state.completedTaskCount >= 40) {
      goals.push({
        id: nextGoalId('creative'),
        priority: 'creative',
        urgency: 2,
        description: 'Experiment with redstone mechanisms',
        keywords: ['redstone', 'experiment', 'creative'],
        source: 'creative-impulse',
      });
    }

    if (state.completedTaskCount >= 35) {
      goals.push({
        id: nextGoalId('creative'),
        priority: 'creative',
        urgency: 2,
        description: 'Optimize an existing farm or system',
        keywords: ['optimize', 'farm', 'creative', 'improve'],
        source: 'creative-impulse',
      });
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private hasEdibleFood(inventory: Record<string, number>): boolean {
    const edible = [
      'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken',
      'cooked_mutton', 'cooked_rabbit', 'cooked_salmon', 'cooked_cod',
      'baked_potato', 'apple', 'golden_apple', 'enchanted_golden_apple',
      'melon_slice', 'sweet_berries', 'carrot', 'golden_carrot',
      'mushroom_stew', 'rabbit_stew', 'beetroot_soup', 'beetroot',
      'dried_kelp', 'cookie', 'pumpkin_pie', 'cake', 'honey_bottle',
    ];
    return edible.some((food) => (inventory[food] ?? 0) > 0);
  }

  private extractKeywords(description: string): string[] {
    return description
      .toLowerCase()
      .replace(/[^a-z0-9\s_]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2);
  }
}
