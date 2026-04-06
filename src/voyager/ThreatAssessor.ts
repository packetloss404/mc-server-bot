import { Bot } from 'mineflayer';
import { Entity } from 'prismarine-entity';
import { logger } from '../util/logger';

export interface Threat {
  type: 'hostile_mob' | 'player_threat' | 'environmental' | 'starvation' | 'drowning';
  source: string;
  distance: number;
  dangerLevel: number;
  position?: { x: number; y: number; z: number };
  description: string;
}

export interface ThreatAssessment {
  overallThreatLevel: number;
  threats: Threat[];
  suggestedAction: 'none' | 'flee' | 'fight' | 'eat' | 'surface' | 'shelter' | 'equip';
  timestamp: number;
}

const HOSTILE_MOBS = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
  'witch', 'blaze', 'ghast', 'magma_cube', 'slime', 'phantom', 'drowned',
  'husk', 'stray', 'wither_skeleton', 'pillager', 'vindicator', 'evoker',
  'ravager', 'hoglin', 'piglin_brute', 'warden',
]);

/** Mobs with ranged attacks that are dangerous at longer distances. */
const RANGED_MOBS = new Set(['skeleton', 'stray', 'blaze', 'ghast', 'pillager']);

/** Environmental hazard block names. */
const LAVA_BLOCKS = new Set(['lava', 'flowing_lava']);
const FIRE_BLOCKS = new Set(['fire', 'soul_fire']);
const CACTUS_BLOCKS = new Set(['cactus']);

interface NearbyHostile {
  entity: Entity;
  name: string;
  distance: number;
}

export type AffinityCheckFn = (playerName: string) => number;

export class ThreatAssessor {
  /**
   * Perform a full threat assessment of the bot's surroundings.
   * @param affinityCheck Optional callback that returns an affinity score for a player name.
   *   Negative values indicate hostility.
   */
  assess(bot: Bot, affinityCheck?: AffinityCheckFn): ThreatAssessment {
    const threats: Threat[] = [];

    try {
      this.assessHostileMobs(bot, threats);
      this.assessEnvironment(bot, threats);
      this.assessStarvation(bot, threats);
      this.assessDrowning(bot, threats);
      this.assessPlayerThreats(bot, threats, affinityCheck);
    } catch (err) {
      logger.warn({ err }, 'ThreatAssessor: error during assessment');
    }

    const overallThreatLevel = threats.length > 0
      ? Math.min(10, Math.max(...threats.map((t) => t.dangerLevel)))
      : 0;

    const assessment: ThreatAssessment = {
      overallThreatLevel,
      threats,
      suggestedAction: 'none',
      timestamp: Date.now(),
    };

    // Attach a preliminary suggested action based on bot state
    assessment.suggestedAction = this.suggestAction(assessment, {
      health: bot.health,
      food: bot.food,
      hasWeapon: this.hasWeapon(bot),
      hasArmor: this.hasArmor(bot),
    });

    return assessment;
  }

  /**
   * Determine the best response action given an assessment and the bot's current state.
   */
  suggestAction(
    assessment: ThreatAssessment,
    botState: { health: number; food: number; hasWeapon: boolean; hasArmor: boolean },
  ): ThreatAssessment['suggestedAction'] {
    if (assessment.threats.length === 0) return 'none';

    // Drowning is highest priority
    const drowning = assessment.threats.find((t) => t.type === 'drowning');
    if (drowning && drowning.dangerLevel >= 7) return 'surface';

    // Starvation
    const starving = assessment.threats.find((t) => t.type === 'starvation');
    if (starving && starving.dangerLevel >= 5) return 'eat';

    // Hostile mobs
    const hostileMobs = assessment.threats.filter((t) => t.type === 'hostile_mob');
    if (hostileMobs.length > 0) {
      const closestDanger = Math.max(...hostileMobs.map((t) => t.dangerLevel));
      const closestDist = Math.min(...hostileMobs.map((t) => t.distance));

      const isWeak = botState.health <= 8 || !botState.hasArmor;

      if (closestDist <= 8 && isWeak) return 'flee';
      if (closestDist <= 8 && !isWeak) return 'fight';

      // Mob is farther away but still a threat — equip gear
      if (closestDanger >= 4 && closestDist > 8) return 'equip';
    }

    // Player threats
    const playerThreats = assessment.threats.filter((t) => t.type === 'player_threat');
    if (playerThreats.length > 0) {
      const isWeak = botState.health <= 8 || !botState.hasArmor;
      if (isWeak) return 'flee';
      return 'fight';
    }

    // Environmental — lava / fire / fall
    const envThreats = assessment.threats.filter((t) => t.type === 'environmental');
    if (envThreats.some((t) => t.dangerLevel >= 5)) return 'flee';

    return 'none';
  }

  /**
   * Return a list of hostile mobs near the bot with their distances.
   */
  getHostileMobs(bot: Bot): NearbyHostile[] {
    const pos = bot.entity.position;
    const hostiles: NearbyHostile[] = [];

    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      if (!entity.position) continue;

      const name = entity.name ?? entity.type ?? 'unknown';
      if (!this.isHostileMob(name)) continue;

      const distance = entity.position.distanceTo(pos);
      if (distance > 24) continue;

      hostiles.push({ entity, name, distance });
    }

    hostiles.sort((a, b) => a.distance - b.distance);
    return hostiles;
  }

  /**
   * Check if an entity name corresponds to a known hostile mob.
   */
  isHostileMob(entityName: string): boolean {
    return HOSTILE_MOBS.has(entityName.toLowerCase());
  }

  // ---------------------------------------------------------------------------
  // Private assessment helpers
  // ---------------------------------------------------------------------------

  private assessHostileMobs(bot: Bot, threats: Threat[]): void {
    const hostiles = this.getHostileMobs(bot);
    if (hostiles.length === 0) return;

    // Group multiplier: more hostiles nearby = more danger
    const groupMultiplier = hostiles.length >= 4 ? 1.5
      : hostiles.length >= 2 ? 1.2
      : 1.0;

    for (const { entity, name, distance } of hostiles) {
      let danger = this.baseDangerForMob(name, distance);
      danger = Math.min(10, danger * groupMultiplier);

      threats.push({
        type: 'hostile_mob',
        source: name,
        distance: Math.round(distance * 10) / 10,
        dangerLevel: Math.round(danger * 10) / 10,
        position: {
          x: Math.round(entity.position.x),
          y: Math.round(entity.position.y),
          z: Math.round(entity.position.z),
        },
        description: `${name} at ${Math.round(distance)} blocks`,
      });
    }
  }

  private baseDangerForMob(name: string, distance: number): number {
    // Creeper special case — extremely dangerous up close
    if (name === 'creeper') {
      if (distance <= 5) return 9.5;
      if (distance <= 10) return 7;
      return Math.max(3, 7 - (distance - 10) * 0.3);
    }

    // Warden is always extremely dangerous
    if (name === 'warden') {
      return Math.max(8, 10 - distance * 0.05);
    }

    // Ranged mobs are dangerous even at longer distances
    if (RANGED_MOBS.has(name)) {
      if (distance <= 16) return Math.max(6, 8 - distance * 0.15);
      return Math.max(3, 6 - (distance - 16) * 0.4);
    }

    // Default melee hostile: danger scales inversely with distance
    if (distance <= 4) return 7;
    if (distance <= 8) return 5;
    if (distance <= 16) return 3;
    return 2;
  }

  private assessEnvironment(bot: Bot, threats: Threat[]): void {
    const pos = bot.entity.position;

    // Scan nearby blocks for hazards (3 block radius for lava, 4 for fire/cactus)
    const scanRadius = 4;
    let lavaClose = false;
    let fireClose = false;
    let cactusClose = false;

    for (let dx = -scanRadius; dx <= scanRadius; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dz = -scanRadius; dz <= scanRadius; dz++) {
          try {
            const block = bot.blockAt(pos.offset(dx, dy, dz));
            if (!block) continue;

            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (LAVA_BLOCKS.has(block.name) && dist <= 3) lavaClose = true;
            if (FIRE_BLOCKS.has(block.name) && dist <= 4) fireClose = true;
            if (CACTUS_BLOCKS.has(block.name) && dist <= 3) cactusClose = true;
          } catch { /* ignore */ }
        }
      }
    }

    if (lavaClose) {
      threats.push({
        type: 'environmental',
        source: 'lava',
        distance: 3,
        dangerLevel: 8,
        description: 'Lava within 3 blocks',
      });
    }

    if (fireClose) {
      threats.push({
        type: 'environmental',
        source: 'fire',
        distance: 4,
        dangerLevel: 4,
        description: 'Fire blocks nearby',
      });
    }

    if (cactusClose) {
      threats.push({
        type: 'environmental',
        source: 'cactus',
        distance: 3,
        dangerLevel: 2,
        description: 'Cactus nearby',
      });
    }

    // Fall risk: check if blocks below the bot are air
    try {
      const below1 = bot.blockAt(pos.offset(0, -1, 0));
      const below2 = bot.blockAt(pos.offset(0, -2, 0));
      const below3 = bot.blockAt(pos.offset(0, -3, 0));
      const isOnEdge = below1 && (below1.name === 'air' || below1.name === 'cave_air');
      const deepFall = below2 && (below2.name === 'air' || below2.name === 'cave_air')
        && below3 && (below3.name === 'air' || below3.name === 'cave_air');

      if (isOnEdge && deepFall) {
        threats.push({
          type: 'environmental',
          source: 'fall_risk',
          distance: 0,
          dangerLevel: 5,
          description: 'High fall risk — air below bot position',
        });
      }
    } catch { /* ignore */ }
  }

  private assessStarvation(bot: Bot, threats: Threat[]): void {
    const food = bot.food;
    if (food <= 3) {
      threats.push({
        type: 'starvation',
        source: 'low_food',
        distance: 0,
        dangerLevel: 7,
        description: `Food critically low (${food}/20)`,
      });
    } else if (food <= 6) {
      threats.push({
        type: 'starvation',
        source: 'low_food',
        distance: 0,
        dangerLevel: 4,
        description: `Food low (${food}/20)`,
      });
    }
  }

  private assessDrowning(bot: Bot, threats: Threat[]): void {
    const oxygen = (bot.entity as any).oxygenLevel ?? 300;
    if (oxygen < 100) {
      threats.push({
        type: 'drowning',
        source: 'low_oxygen',
        distance: 0,
        dangerLevel: 9,
        description: `Oxygen critically low (${oxygen})`,
      });
    }
  }

  private assessPlayerThreats(
    bot: Bot,
    threats: Threat[],
    affinityCheck?: AffinityCheckFn,
  ): void {
    if (!affinityCheck) return;

    const pos = bot.entity.position;

    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      if (entity.type !== 'player') continue;
      if (!entity.position) continue;

      const distance = entity.position.distanceTo(pos);
      if (distance > 8) continue;

      const playerName = (entity as any).username || 'unknown';
      const affinity = affinityCheck(playerName);
      if (affinity >= 0) continue;

      // Check if the player appears to be holding a weapon
      const heldItem = (entity as any).heldItem;
      const hasWeapon = heldItem && /sword|axe|trident|mace/i.test(heldItem.name ?? '');
      if (!hasWeapon) continue;

      const danger = Math.min(10, 6 + Math.abs(affinity) * 0.5 + (8 - distance) * 0.3);

      threats.push({
        type: 'player_threat',
        source: playerName,
        distance: Math.round(distance * 10) / 10,
        dangerLevel: Math.round(danger * 10) / 10,
        position: {
          x: Math.round(entity.position.x),
          y: Math.round(entity.position.y),
          z: Math.round(entity.position.z),
        },
        description: `Hostile player ${playerName} with weapon at ${Math.round(distance)} blocks`,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Equipment helpers
  // ---------------------------------------------------------------------------

  private hasWeapon(bot: Bot): boolean {
    const items = bot.inventory.items();
    return items.some((i) => /sword|axe|trident|mace/i.test(i.name));
  }

  private hasArmor(bot: Bot): boolean {
    // Check equipped armor slots (head=5, chest=6, legs=7, feet=8)
    for (const slotIndex of [5, 6, 7, 8]) {
      const slot = bot.inventory.slots[slotIndex];
      if (slot) return true;
    }
    return false;
  }
}
