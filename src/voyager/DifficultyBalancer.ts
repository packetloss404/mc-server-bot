// TODO: NOT YET WIRED. The class is instantiated by BotManager and exposed via
// GET /api/difficulty, but no producer feeds it player join/death events, so
// calculateDifficulty() always returns the default tier with empty profiles.
// To wire it up:
//   1. In src/server/api.ts player-join/player-leave handlers, call
//      botManager.getDifficultyBalancer().recordPlayerJoin(name) /
//      .recordPlayerDeath(name) so player profiles accumulate.
//   2. In src/voyager/VoyagerLoop.ts (or BotInstance), read
//      getBehaviorModifiers(personality) once per cycle and apply them to
//      task selection (taskCooldownMultiplier), chat (chatProbability), and
//      combat (combatAggressiveness).
//   3. Once those producers + readers exist, delete this comment block.

import { logger } from '../util/logger';

export type DifficultyTier = 'peaceful' | 'easy' | 'normal' | 'hard' | 'challenge';

export interface DifficultyState {
  tier: DifficultyTier;
  playerCount: number;
  averagePlayerSkill: number;
  botAutonomy: number;
  eventFrequency: number;
  botChatFrequency: number;
  combatAggressiveness: number;
  helpfulness: number;
}

export interface PlayerProfile {
  name: string;
  hasPlayedBefore: boolean;
  bestToolTier: 'none' | 'wood' | 'stone' | 'iron' | 'diamond' | 'netherite';
  hasElytra: boolean;
  deathCount: number;
  playtimeMinutes: number;
  lastSeen: number;
}

export interface BotBehaviorModifiers {
  taskCooldownMultiplier: number;
  preferredTaskTypes: string[];
  chatProbability: number;
  helpRadius: number;
}

const TOOL_TIER_SKILL: Record<PlayerProfile['bestToolTier'], number> = {
  none: 0.1,
  wood: 0.3,
  stone: 0.3,
  iron: 0.6,
  diamond: 0.8,
  netherite: 0.9,
};

/** Personality types more inclined to help players proactively. */
const HELPFUL_PERSONALITIES = new Set(['farmer', 'elder', 'merchant']);

export class DifficultyBalancer {
  private players: Map<string, PlayerProfile> = new Map();

  updatePlayerState(profile: PlayerProfile): void {
    this.players.set(profile.name, profile);
    logger.debug({ player: profile.name, skill: this.estimatePlayerSkill(profile) }, 'difficulty: player state updated');
  }

  removePlayer(name: string): void {
    this.players.delete(name);
    logger.debug({ player: name, remaining: this.players.size }, 'difficulty: player removed');
  }

  // ── Core Difficulty Calculation ──────────────────────────────────────

  calculateDifficulty(): DifficultyState {
    const playerCount = this.players.size;
    const avgSkill = this.averageSkill();
    const baseTier = this.baseTierFromCount(playerCount);
    const tier = this.adjustTierBySkill(baseTier, avgSkill);

    const state: DifficultyState = {
      tier,
      playerCount,
      averagePlayerSkill: avgSkill,
      ...this.parametersForTier(tier),
    };

    logger.info({ tier, playerCount, avgSkill: avgSkill.toFixed(2) }, 'difficulty: recalculated');
    return state;
  }

  // ── Player Skill Estimation ─────────────────────────────────────────

  estimatePlayerSkill(profile: PlayerProfile): number {
    if (profile.hasElytra) return 0.95;

    let skill = TOOL_TIER_SKILL[profile.bestToolTier];

    // High recent deaths suggest the player is struggling.
    if (profile.deathCount > 3) {
      skill = Math.max(0, skill - 0.2);
    }

    // Long playtime suggests some experience.
    if (profile.playtimeMinutes > 120) {
      skill = Math.min(1, skill + 0.1);
    }

    return skill;
  }

  // ── Behavior Modifiers for VoyagerLoop ──────────────────────────────

  getBotBehaviorModifiers(): BotBehaviorModifiers {
    const diff = this.calculateDifficulty();

    const cooldownMap: Record<DifficultyTier, number> = {
      peaceful: 2.0,
      easy: 1.5,
      normal: 1.0,
      hard: 0.7,
      challenge: 0.5,
    };

    const taskMap: Record<DifficultyTier, string[]> = {
      peaceful: ['farming', 'building', 'crafting', 'smelting'],
      easy: ['farming', 'building', 'mining', 'crafting'],
      normal: ['mining', 'crafting', 'building', 'combat', 'farming'],
      hard: ['mining', 'combat', 'exploration', 'building'],
      challenge: ['combat', 'mining', 'exploration'],
    };

    // helpRadius: peaceful bots stay close (16), hard bots range far (64)
    const radiusMap: Record<DifficultyTier, number> = {
      peaceful: 16,
      easy: 48,
      normal: 32,
      hard: 24,
      challenge: 64,
    };

    return {
      taskCooldownMultiplier: cooldownMap[diff.tier],
      preferredTaskTypes: taskMap[diff.tier],
      chatProbability: diff.botChatFrequency,
      helpRadius: radiusMap[diff.tier],
    };
  }

  shouldOfferHelp(playerName: string, botPersonality: string): boolean {
    const diff = this.calculateDifficulty();
    const profile = this.players.get(playerName);

    // If we don't know the player, only help in easy mode with a helpful personality.
    if (!profile) {
      return diff.helpfulness >= 0.8 && HELPFUL_PERSONALITIES.has(botPersonality);
    }

    const skill = this.estimatePlayerSkill(profile);

    // Newer / lower-skill players get more help.
    const needsFactor = 1 - skill;

    // Personality boost for helpful types.
    const personalityBoost = HELPFUL_PERSONALITIES.has(botPersonality) ? 0.2 : 0;

    // Combine helpfulness from difficulty state with player need.
    const helpChance = diff.helpfulness * (0.5 + 0.5 * needsFactor) + personalityBoost;

    return helpChance > 0.5;
  }

  getEventIntensityMultiplier(): number {
    const diff = this.calculateDifficulty();

    // Scale from 0.5x (peaceful) to 2.0x (challenge).
    const multiplierMap: Record<DifficultyTier, number> = {
      peaceful: 0.5,
      easy: 0.75,
      normal: 1.0,
      hard: 1.5,
      challenge: 2.0,
    };

    return multiplierMap[diff.tier];
  }

  // ── Internals ───────────────────────────────────────────────────────

  private averageSkill(): number {
    if (this.players.size === 0) return 0;
    let total = 0;
    for (const p of this.players.values()) {
      total += this.estimatePlayerSkill(p);
    }
    return total / this.players.size;
  }

  private baseTierFromCount(count: number): DifficultyTier {
    if (count === 0) return 'peaceful';
    if (count <= 2) return 'easy';
    if (count <= 5) return 'normal';
    return 'hard';
  }

  private adjustTierBySkill(base: DifficultyTier, avgSkill: number): DifficultyTier {
    const ordered: DifficultyTier[] = ['peaceful', 'easy', 'normal', 'hard', 'challenge'];
    let idx = ordered.indexOf(base);

    if (avgSkill > 0.7 && idx < ordered.length - 1) {
      idx++;
      logger.debug('difficulty: bumped tier up due to high average skill');
    } else if (avgSkill < 0.3 && idx > 0) {
      idx--;
      logger.debug('difficulty: bumped tier down due to low average skill');
    }

    return ordered[idx];
  }

  private parametersForTier(tier: DifficultyTier): Omit<DifficultyState, 'tier' | 'playerCount' | 'averagePlayerSkill'> {
    switch (tier) {
      case 'peaceful':
        return {
          botAutonomy: 0.3,
          eventFrequency: 0.1,
          botChatFrequency: 0.1,
          combatAggressiveness: 0,
          helpfulness: 0.2,
        };
      case 'easy':
        return {
          botAutonomy: 0.4,
          eventFrequency: 0.3,
          botChatFrequency: 0.5,
          combatAggressiveness: 0.3,
          helpfulness: 0.8,
        };
      case 'normal':
        return {
          botAutonomy: 0.5,
          eventFrequency: 0.5,
          botChatFrequency: 0.4,
          combatAggressiveness: 0.5,
          helpfulness: 0.5,
        };
      case 'hard':
        return {
          botAutonomy: 0.8,
          eventFrequency: 0.7,
          botChatFrequency: 0.3,
          combatAggressiveness: 0.7,
          helpfulness: 0.3,
        };
      case 'challenge':
        return {
          botAutonomy: 0.9,
          eventFrequency: 0.9,
          botChatFrequency: 0.2,
          combatAggressiveness: 0.9,
          helpfulness: 0.1,
        };
    }
  }
}
