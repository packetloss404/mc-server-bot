// TODO: NOT YET WIRED. The class is instantiated by BotManager and exposed via
// GET /api/players/:name/intent, but no producer feeds it player actions, so
// predictIntent() always returns 'unknown'. To wire it up:
//   1. In src/server/socketEvents.ts (or wherever player chat/move events land),
//      call botManager.getPlayerIntentModel().recordAction(playerName, action)
//      on each block_placed / block_broken / item_crafted / chat / death event.
//   2. In src/voyager/GoalGenerator.ts, read predictIntent(playerName) for any
//      nearby player and bias goal selection toward suggestedTask when the
//      prediction confidence is high.
//   3. Once those producers exist, delete this comment block.

import { logger } from '../util/logger';

export type PlayerIntent =
  | 'building_base'
  | 'mining_expedition'
  | 'farming'
  | 'combat_preparation'
  | 'exploring'
  | 'nether_preparation'
  | 'enchanting'
  | 'trading'
  | 'struggling'
  | 'unknown';

export interface IntentPrediction {
  intent: PlayerIntent;
  confidence: number;
  evidence: string[];
  suggestedBotResponse: string;
  suggestedTask?: string;
}

export interface PlayerAction {
  type: 'block_placed' | 'block_broken' | 'item_crafted' | 'entity_killed' | 'movement' | 'death' | 'chat';
  detail: string;
  position?: { x: number; y: number; z: number };
  timestamp: number;
}

const MAX_ACTIONS = 30;
const TIME_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const BUILDING_BLOCKS = new Set([
  'cobblestone', 'stone', 'oak_planks', 'spruce_planks', 'birch_planks',
  'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks',
  'cherry_planks', 'glass', 'glass_pane', 'oak_door', 'spruce_door',
  'birch_door', 'iron_door', 'oak_stairs', 'cobblestone_stairs',
  'stone_bricks', 'bricks', 'oak_fence', 'torch', 'oak_slab',
  'cobblestone_slab', 'stone_slab', 'smooth_stone',
]);

const ORE_BLOCKS = new Set([
  'stone', 'deepslate', 'coal_ore', 'iron_ore', 'gold_ore',
  'diamond_ore', 'redstone_ore', 'lapis_ore', 'emerald_ore',
  'copper_ore', 'deepslate_coal_ore', 'deepslate_iron_ore',
  'deepslate_gold_ore', 'deepslate_diamond_ore', 'deepslate_redstone_ore',
  'deepslate_lapis_ore', 'deepslate_emerald_ore', 'deepslate_copper_ore',
]);

const FARM_BLOCKS = new Set([
  'farmland', 'wheat_seeds', 'beetroot_seeds', 'carrot', 'potato',
  'melon_seeds', 'pumpkin_seeds', 'wheat', 'beetroots', 'carrots',
  'potatoes', 'melon', 'pumpkin', 'sugar_cane', 'cocoa_beans',
]);

const COMBAT_ITEMS = new Set([
  'wooden_sword', 'stone_sword', 'iron_sword', 'golden_sword', 'diamond_sword',
  'netherite_sword', 'bow', 'crossbow', 'arrow', 'shield',
  'leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots',
  'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
  'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
  'chainmail_helmet', 'chainmail_chestplate', 'chainmail_leggings', 'chainmail_boots',
]);

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'enderman',
  'witch', 'pillager', 'vindicator', 'ravager', 'phantom',
  'blaze', 'ghast', 'wither_skeleton', 'drowned', 'husk', 'stray',
]);

const ENCHANTING_ITEMS = new Set([
  'bookshelf', 'enchanting_table', 'lapis_lazuli', 'book',
  'experience_bottle', 'anvil',
]);

interface IntentPattern {
  intent: PlayerIntent;
  evaluate: (actions: PlayerAction[]) => { score: number; evidence: string[] };
  suggestedBotResponse: string;
  suggestedTask?: string;
  maxScore: number;
}

function positionsInSmallArea(positions: { x: number; y: number; z: number }[], radius: number): boolean {
  if (positions.length < 2) return false;
  const xs = positions.map(p => p.x);
  const zs = positions.map(p => p.z);
  const rangeX = Math.max(...xs) - Math.min(...xs);
  const rangeZ = Math.max(...zs) - Math.min(...zs);
  return rangeX <= radius && rangeZ <= radius;
}

function movementIsDownward(actions: PlayerAction[]): boolean {
  const moves = actions.filter(a => a.type === 'movement' && a.position);
  if (moves.length < 2) return false;
  const first = moves[0].position!;
  const last = moves[moves.length - 1].position!;
  return last.y < first.y - 5;
}

function movementIsDirectional(actions: PlayerAction[]): boolean {
  const moves = actions.filter(a => a.type === 'movement' && a.position);
  if (moves.length < 3) return false;

  // Check if movement is consistently in one direction with few revisits
  const visited = new Set<string>();
  let revisits = 0;
  for (const m of moves) {
    const key = `${Math.floor(m.position!.x / 16)},${Math.floor(m.position!.z / 16)}`;
    if (visited.has(key)) revisits++;
    else visited.add(key);
  }

  // Low revisit ratio means exploring, not circling
  return revisits / moves.length < 0.3 && visited.size >= 3;
}

const PATTERNS: IntentPattern[] = [
  {
    intent: 'building_base',
    maxScore: 10,
    suggestedBotResponse: "Looks like you're building! I can help gather materials.",
    suggestedTask: 'gather building materials for nearby player',
    evaluate(actions) {
      let score = 0;
      const evidence: string[] = [];
      const placed = actions.filter(a => a.type === 'block_placed');
      const buildingPlaced = placed.filter(a => BUILDING_BLOCKS.has(a.detail));

      if (buildingPlaced.length >= 5) {
        score += 3;
        evidence.push(`Placed ${buildingPlaced.length} building blocks`);
      }
      if (buildingPlaced.length >= 10) {
        score += 2;
      }

      const positions = buildingPlaced.filter(a => a.position).map(a => a.position!);
      if (positionsInSmallArea(positions, 20)) {
        score += 3;
        evidence.push('Building concentrated in small area');
      }

      const craftedTable = actions.some(a => a.type === 'item_crafted' && a.detail === 'crafting_table');
      const craftedFurnace = actions.some(a => a.type === 'item_crafted' && a.detail === 'furnace');
      if (craftedTable) { score += 1; evidence.push('Crafted a crafting table'); }
      if (craftedFurnace) { score += 1; evidence.push('Crafted a furnace'); }

      return { score, evidence };
    },
  },
  {
    intent: 'mining_expedition',
    maxScore: 10,
    suggestedBotResponse: "Mining deep? I can craft you torches or a better pickaxe.",
    suggestedTask: 'craft torches and bring to player',
    evaluate(actions) {
      let score = 0;
      const evidence: string[] = [];
      const broken = actions.filter(a => a.type === 'block_broken');
      const oreBroken = broken.filter(a => ORE_BLOCKS.has(a.detail));

      if (oreBroken.length >= 3) {
        score += 3;
        evidence.push(`Broke ${oreBroken.length} stone/ore blocks`);
      }
      if (oreBroken.length >= 8) {
        score += 2;
      }

      if (movementIsDownward(actions)) {
        score += 3;
        evidence.push('Moving downward');
      }

      const craftedPick = actions.some(a => a.type === 'item_crafted' && a.detail.includes('pickaxe'));
      if (craftedPick) { score += 2; evidence.push('Crafted a pickaxe'); }

      return { score, evidence };
    },
  },
  {
    intent: 'farming',
    maxScore: 10,
    suggestedBotResponse: 'Nice farm! I can help plant or harvest.',
    suggestedTask: 'help player with farming',
    evaluate(actions) {
      let score = 0;
      const evidence: string[] = [];

      const farmPlaced = actions.filter(a => a.type === 'block_placed' && FARM_BLOCKS.has(a.detail));
      const farmBroken = actions.filter(a => a.type === 'block_broken' && FARM_BLOCKS.has(a.detail));
      const farmCrafted = actions.filter(a => a.type === 'item_crafted' && (a.detail === 'hoe' || a.detail.includes('_hoe')));

      if (farmPlaced.length >= 3) {
        score += 3;
        evidence.push(`Planted ${farmPlaced.length} farm items`);
      }
      if (farmBroken.length >= 3) {
        score += 3;
        evidence.push(`Harvested ${farmBroken.length} crops`);
      }
      if (farmPlaced.length + farmBroken.length >= 8) {
        score += 2;
      }
      if (farmCrafted.length > 0) {
        score += 2;
        evidence.push('Crafted a hoe');
      }

      return { score, evidence };
    },
  },
  {
    intent: 'combat_preparation',
    maxScore: 10,
    suggestedBotResponse: 'Gearing up for a fight? I can watch your back.',
    suggestedTask: 'escort and protect nearby player',
    evaluate(actions) {
      let score = 0;
      const evidence: string[] = [];

      const combatCrafted = actions.filter(a => a.type === 'item_crafted' && COMBAT_ITEMS.has(a.detail));
      const hostileKills = actions.filter(a => a.type === 'entity_killed' && HOSTILE_MOBS.has(a.detail));

      if (combatCrafted.length >= 1) {
        score += 3;
        evidence.push(`Crafted combat gear: ${combatCrafted.map(a => a.detail).join(', ')}`);
      }
      if (combatCrafted.length >= 3) {
        score += 2;
      }
      if (hostileKills.length >= 2) {
        score += 3;
        evidence.push(`Killed ${hostileKills.length} hostile mobs`);
      }
      if (hostileKills.length >= 5) {
        score += 2;
      }

      return { score, evidence };
    },
  },
  {
    intent: 'nether_preparation',
    maxScore: 10,
    suggestedBotResponse: "Building a Nether portal? I can craft a flint and steel.",
    suggestedTask: 'craft flint and steel for player',
    evaluate(actions) {
      let score = 0;
      const evidence: string[] = [];

      const obsidianActions = actions.filter(
        a => (a.type === 'block_placed' || a.type === 'block_broken') && a.detail === 'obsidian',
      );
      const flintCrafted = actions.some(a => a.type === 'item_crafted' && a.detail === 'flint_and_steel');

      if (obsidianActions.length >= 4) {
        score += 3;
        evidence.push(`Placed/mined ${obsidianActions.length} obsidian`);
      }
      if (obsidianActions.length >= 10) {
        score += 3;
        evidence.push('Collecting enough obsidian for a portal');
      }
      if (flintCrafted) {
        score += 4;
        evidence.push('Crafted flint and steel');
      }

      return { score, evidence };
    },
  },
  {
    intent: 'exploring',
    maxScore: 10,
    suggestedBotResponse: "Exploring the area? I know what's nearby if you need directions.",
    evaluate(actions) {
      let score = 0;
      const evidence: string[] = [];

      if (movementIsDirectional(actions)) {
        score += 5;
        evidence.push('Consistent directional movement');
      }

      const moves = actions.filter(a => a.type === 'movement');
      const nonMoves = actions.filter(a => a.type !== 'movement');
      if (moves.length >= 5 && nonMoves.length <= 3) {
        score += 3;
        evidence.push('Mostly moving with little other activity');
      }

      // Minimal block interactions suggest exploring, not building/mining
      const blockActions = actions.filter(a => a.type === 'block_placed' || a.type === 'block_broken');
      if (blockActions.length <= 2 && moves.length >= 5) {
        score += 2;
        evidence.push('Very few block interactions while moving');
      }

      return { score, evidence };
    },
  },
  {
    intent: 'enchanting',
    maxScore: 10,
    suggestedBotResponse: 'Setting up enchanting? I can gather lapis for you.',
    suggestedTask: 'mine lapis lazuli for player',
    evaluate(actions) {
      let score = 0;
      const evidence: string[] = [];

      const enchantItems = actions.filter(
        a => (a.type === 'item_crafted' || a.type === 'block_placed') && ENCHANTING_ITEMS.has(a.detail),
      );

      if (enchantItems.length >= 1) {
        score += 4;
        evidence.push(`Enchanting activity: ${enchantItems.map(a => a.detail).join(', ')}`);
      }
      if (enchantItems.length >= 3) {
        score += 3;
      }

      const lapisUse = actions.some(
        a => a.detail === 'lapis_lazuli' || a.detail === 'lapis_ore' || a.detail === 'deepslate_lapis_ore',
      );
      if (lapisUse) {
        score += 3;
        evidence.push('Using lapis lazuli');
      }

      return { score, evidence };
    },
  },
  {
    intent: 'trading',
    maxScore: 10,
    suggestedBotResponse: 'Trading with villagers? I can find more emeralds.',
    suggestedTask: 'mine emeralds for player',
    evaluate(actions) {
      let score = 0;
      const evidence: string[] = [];

      const emeraldUse = actions.filter(
        a => a.detail === 'emerald' || a.detail === 'emerald_ore' || a.detail === 'deepslate_emerald_ore',
      );
      if (emeraldUse.length >= 1) {
        score += 4;
        evidence.push('Using emeralds');
      }

      // Chat mentioning trade/villager
      const tradeChatActions = actions.filter(
        a => a.type === 'chat' && /\b(trade|trading|villager|buy|sell|merchant)\b/i.test(a.detail),
      );
      if (tradeChatActions.length > 0) {
        score += 3;
        evidence.push('Mentioned trading in chat');
      }

      // Entity interactions near villagers would come as specific events
      const villagerKill = actions.some(a => a.type === 'entity_killed' && a.detail === 'villager');
      if (!villagerKill && emeraldUse.length >= 2) {
        score += 3;
        evidence.push('Multiple emerald interactions');
      }

      return { score, evidence };
    },
  },
  {
    intent: 'struggling',
    maxScore: 10,
    suggestedBotResponse: 'That area seems dangerous. Want me to clear the mobs or craft you armor?',
    suggestedTask: 'craft armor and weapons for struggling player',
    evaluate(actions) {
      let score = 0;
      const evidence: string[] = [];

      const deaths = actions.filter(a => a.type === 'death');
      if (deaths.length >= 2) {
        score += 4;
        evidence.push(`Died ${deaths.length} times recently`);
      }
      if (deaths.length >= 4) {
        score += 2;
      }

      // Deaths in the same area suggest a specific struggle
      const deathPositions = deaths.filter(a => a.position).map(a => a.position!);
      if (positionsInSmallArea(deathPositions, 30)) {
        score += 2;
        evidence.push('Dying repeatedly in the same area');
      }

      // Low-tier tool crafting after deaths suggests re-equipping
      const lowTierCrafts = actions.filter(
        a => a.type === 'item_crafted' && (a.detail.startsWith('wooden_') || a.detail.startsWith('stone_')),
      );
      if (lowTierCrafts.length >= 2 && deaths.length >= 1) {
        score += 2;
        evidence.push('Re-crafting low-tier tools after deaths');
      }

      return { score, evidence };
    },
  },
];

export class PlayerIntentModel {
  private actionHistory: Map<string, PlayerAction[]> = new Map();

  constructor() {
    logger.debug('PlayerIntentModel initialized');
  }

  recordAction(playerName: string, action: PlayerAction): void {
    if (!this.actionHistory.has(playerName)) {
      this.actionHistory.set(playerName, []);
    }

    const actions = this.actionHistory.get(playerName)!;
    actions.push(action);

    // Trim to rolling window: max 30 actions within 5 minutes
    this.pruneActions(playerName);

    logger.debug({ playerName, actionType: action.type, detail: action.detail }, 'Recorded player action');
  }

  predictIntent(playerName: string): IntentPrediction {
    const actions = this.getRecentActions(playerName);

    if (actions.length === 0) {
      return {
        intent: 'unknown',
        confidence: 0,
        evidence: ['No recent actions recorded'],
        suggestedBotResponse: '',
      };
    }

    let bestIntent: PlayerIntent = 'unknown';
    let bestConfidence = 0;
    let bestEvidence: string[] = [];
    let bestResponse = '';
    let bestTask: string | undefined;

    for (const pattern of PATTERNS) {
      const { score, evidence } = pattern.evaluate(actions);
      const confidence = Math.min(score / pattern.maxScore, 1);

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestIntent = pattern.intent;
        bestEvidence = evidence;
        bestResponse = pattern.suggestedBotResponse;
        bestTask = pattern.suggestedTask;
      }
    }

    if (bestConfidence < 0.3) {
      return {
        intent: 'unknown',
        confidence: bestConfidence,
        evidence: bestEvidence.length > 0 ? bestEvidence : ['No strong pattern detected'],
        suggestedBotResponse: '',
      };
    }

    logger.debug(
      { playerName, intent: bestIntent, confidence: bestConfidence },
      'Predicted player intent',
    );

    const prediction: IntentPrediction = {
      intent: bestIntent,
      confidence: bestConfidence,
      evidence: bestEvidence,
      suggestedBotResponse: bestResponse,
    };
    if (bestTask) {
      prediction.suggestedTask = bestTask;
    }
    return prediction;
  }

  getActionHistory(playerName: string): PlayerAction[] {
    return this.getRecentActions(playerName);
  }

  clearPlayer(playerName: string): void {
    this.actionHistory.delete(playerName);
    logger.debug({ playerName }, 'Cleared player intent history');
  }

  private getRecentActions(playerName: string): PlayerAction[] {
    const actions = this.actionHistory.get(playerName);
    if (!actions) return [];

    const cutoff = Date.now() - TIME_WINDOW_MS;
    return actions.filter(a => a.timestamp >= cutoff);
  }

  private pruneActions(playerName: string): void {
    const actions = this.actionHistory.get(playerName);
    if (!actions) return;

    const cutoff = Date.now() - TIME_WINDOW_MS;

    // Remove actions older than 5 minutes
    let startIdx = 0;
    while (startIdx < actions.length && actions[startIdx].timestamp < cutoff) {
      startIdx++;
    }
    if (startIdx > 0) {
      actions.splice(0, startIdx);
    }

    // Keep only the last 30
    if (actions.length > MAX_ACTIONS) {
      actions.splice(0, actions.length - MAX_ACTIONS);
    }
  }
}
