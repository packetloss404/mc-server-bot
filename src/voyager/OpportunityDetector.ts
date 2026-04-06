import { Bot } from 'mineflayer';
import { logger } from '../util/logger';

export interface Opportunity {
  type: 'valuable_resource' | 'structure' | 'surface_items' | 'harvestable' | 'animal';
  name: string;
  position: { x: number; y: number; z: number };
  value: number;
  description: string;
  distance: number;
}

export interface OpportunityScan {
  opportunities: Opportunity[];
  timestamp: number;
  botPosition: { x: number; y: number; z: number };
}

interface OreConfig {
  name: string;
  value: number;
}

const VALUABLE_ORES: OreConfig[] = [
  { name: 'diamond_ore', value: 10 },
  { name: 'deepslate_diamond_ore', value: 10 },
  { name: 'emerald_ore', value: 9 },
  { name: 'deepslate_emerald_ore', value: 9 },
  { name: 'gold_ore', value: 7 },
  { name: 'deepslate_gold_ore', value: 7 },
  { name: 'nether_gold_ore', value: 7 },
  { name: 'iron_ore', value: 6 },
  { name: 'deepslate_iron_ore', value: 6 },
  { name: 'lapis_ore', value: 5 },
  { name: 'deepslate_lapis_ore', value: 5 },
  { name: 'redstone_ore', value: 5 },
  { name: 'deepslate_redstone_ore', value: 5 },
  { name: 'coal_ore', value: 3 },
  { name: 'deepslate_coal_ore', value: 3 },
  { name: 'copper_ore', value: 3 },
  { name: 'deepslate_copper_ore', value: 3 },
];

const HARVESTABLE_CROPS: { name: string; value: number; matureCheck?: (metadata: number) => boolean }[] = [
  { name: 'wheat', value: 3, matureCheck: (age) => age === 7 },
  { name: 'carrots', value: 3, matureCheck: (age) => age === 7 },
  { name: 'potatoes', value: 3, matureCheck: (age) => age === 7 },
  { name: 'pumpkin', value: 3 },
  { name: 'melon', value: 3 },
  { name: 'sugar_cane', value: 2 },
];

const FARMABLE_ANIMALS = ['cow', 'pig', 'sheep', 'chicken'];

/** High-value item keywords for scoring dropped items. */
const ITEM_VALUE_MAP: [RegExp, number][] = [
  [/diamond/, 7],
  [/emerald/, 7],
  [/netherite/, 7],
  [/gold/, 5],
  [/iron/, 5],
  [/enchanted/, 6],
  [/totem/, 7],
];
const DEFAULT_ITEM_VALUE = 4;

const CLUSTER_RADIUS = 6;

export class OpportunityDetector {
  scan(bot: Bot): OpportunityScan {
    const pos = bot.entity.position;
    const botPosition = { x: pos.x, y: pos.y, z: pos.z };
    const opportunities: Opportunity[] = [];

    try {
      this.scanOres(bot, opportunities);
    } catch (e) {
      logger.debug({ err: e }, 'OpportunityDetector: ore scan error');
    }

    try {
      this.scanStructures(bot, opportunities);
    } catch (e) {
      logger.debug({ err: e }, 'OpportunityDetector: structure scan error');
    }

    try {
      this.scanSurfaceItems(bot, opportunities);
    } catch (e) {
      logger.debug({ err: e }, 'OpportunityDetector: surface items scan error');
    }

    try {
      this.scanHarvestables(bot, opportunities);
    } catch (e) {
      logger.debug({ err: e }, 'OpportunityDetector: harvestable scan error');
    }

    try {
      this.scanAnimals(bot, opportunities);
    } catch (e) {
      logger.debug({ err: e }, 'OpportunityDetector: animal scan error');
    }

    // Compute distance for each opportunity
    for (const opp of opportunities) {
      opp.distance = Math.sqrt(
        (opp.position.x - pos.x) ** 2 +
        (opp.position.y - pos.y) ** 2 +
        (opp.position.z - pos.z) ** 2,
      );
    }

    // Sort by value descending
    opportunities.sort((a, b) => b.value - a.value);

    return { opportunities, timestamp: Date.now(), botPosition };
  }

  getHighValueOpportunities(scan: OpportunityScan, minValue: number = 5): Opportunity[] {
    return scan.opportunities.filter((o) => o.value >= minValue);
  }

  shouldAnnounce(opportunity: Opportunity): boolean {
    return opportunity.value >= 7;
  }

  // ---------------------------------------------------------------------------
  // Private scanning methods
  // ---------------------------------------------------------------------------

  private scanOres(bot: Bot, out: Opportunity[]): void {
    // Scan highest-value ores first, using findBlocks for efficiency
    for (const ore of VALUABLE_ORES) {
      const positions = bot.findBlocks({
        matching: (block: any) => block.name === ore.name,
        maxDistance: 32,
        count: 20,
      });

      if (positions.length === 0) continue;

      // Cluster nearby positions into a single opportunity
      const clusters = this.clusterPositions(positions);
      for (const cluster of clusters) {
        const center = cluster.center;
        const count = cluster.count;
        const displayName = ore.name.replace(/_/g, ' ');
        out.push({
          type: 'valuable_resource',
          name: ore.name,
          position: center,
          value: ore.value,
          description: `${count} ${displayName} block${count > 1 ? 's' : ''} found`,
          distance: 0, // filled in later
        });
      }
    }
  }

  private scanStructures(bot: Bot, out: Opportunity[]): void {
    const pos = bot.entity.position;

    // Mob spawner
    const spawner = bot.findBlock({
      matching: (b: any) => b.name === 'spawner' || b.name === 'mob_spawner',
      maxDistance: 32,
    });
    if (spawner) {
      out.push({
        type: 'structure',
        name: 'mob_spawner',
        position: { x: spawner.position.x, y: spawner.position.y, z: spawner.position.z },
        value: 9,
        description: 'Dungeon spawner detected',
        distance: 0,
      });
    }

    // Village detection: look for bell, beds, or many doors
    const bell = bot.findBlock({
      matching: (b: any) => b.name === 'bell',
      maxDistance: 32,
    });
    if (bell) {
      out.push({
        type: 'structure',
        name: 'village',
        position: { x: bell.position.x, y: bell.position.y, z: bell.position.z },
        value: 8,
        description: 'Village detected (bell found)',
        distance: 0,
      });
    } else {
      // Fallback: check for multiple beds
      const beds = bot.findBlocks({
        matching: (b: any) => b.name.endsWith('_bed'),
        maxDistance: 32,
        count: 10,
      });
      if (beds.length >= 3) {
        const center = this.averagePosition(beds);
        out.push({
          type: 'structure',
          name: 'village',
          position: center,
          value: 8,
          description: `Village detected (${beds.length} beds found)`,
          distance: 0,
        });
      }
    }

    // Nether portal detection: look for obsidian clusters (at least 10 blocks = minimal portal frame)
    const obsidianBlocks = bot.findBlocks({
      matching: (b: any) => b.name === 'obsidian',
      maxDistance: 32,
      count: 20,
    });
    if (obsidianBlocks.length >= 10) {
      const center = this.averagePosition(obsidianBlocks);
      out.push({
        type: 'structure',
        name: 'nether_portal',
        position: center,
        value: 7,
        description: `Possible nether portal (${obsidianBlocks.length} obsidian blocks)`,
        distance: 0,
      });
    }

    // Chests
    const chests = bot.findBlocks({
      matching: (b: any) => b.name === 'chest',
      maxDistance: 32,
      count: 10,
    });
    for (const chestPos of chests) {
      out.push({
        type: 'structure',
        name: 'chest',
        position: { x: chestPos.x, y: chestPos.y, z: chestPos.z },
        value: 6,
        description: 'Chest found',
        distance: 0,
      });
    }
  }

  private scanSurfaceItems(bot: Bot, out: Opportunity[]): void {
    const pos = bot.entity.position;

    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      if (entity.entityType === undefined) continue;
      // item entities have objectType 'Item' or name 'item'
      if (entity.name !== 'item' && (entity as any).objectType !== 'Item') continue;
      if (!entity.position) continue;

      const dist = entity.position.distanceTo(pos);
      if (dist > 16) continue;

      const metadata = (entity as any).metadata;
      const itemName = metadata?.[8]?.nbtData?.value?.id?.value
        || metadata?.[8]?.itemId
        || (entity as any).displayName
        || 'unknown_item';

      const cleanName = String(itemName).replace(/^minecraft:/, '');
      const value = this.scoreItem(cleanName);

      out.push({
        type: 'surface_items',
        name: cleanName,
        position: { x: entity.position.x, y: entity.position.y, z: entity.position.z },
        value,
        description: `Dropped ${cleanName} on ground`,
        distance: 0,
      });
    }
  }

  private scanHarvestables(bot: Bot, out: Opportunity[]): void {
    for (const crop of HARVESTABLE_CROPS) {
      const positions = bot.findBlocks({
        matching: (b: any) => {
          if (b.name !== crop.name) return false;
          if (crop.matureCheck) {
            // Block metadata property for age varies; try common accessors
            const age = (b as any).metadata ?? (b as any)._properties?.age ?? (b.getProperties?.()?.age);
            return crop.matureCheck(Number(age));
          }
          return true;
        },
        maxDistance: 32,
        count: 20,
      });

      if (positions.length === 0) continue;

      const clusters = this.clusterPositions(positions);
      for (const cluster of clusters) {
        const displayName = crop.name.replace(/_/g, ' ');
        out.push({
          type: 'harvestable',
          name: crop.name,
          position: cluster.center,
          value: crop.value,
          description: `${cluster.count} mature ${displayName} ready to harvest`,
          distance: 0,
        });
      }
    }
  }

  private scanAnimals(bot: Bot, out: Opportunity[]): void {
    const pos = bot.entity.position;
    const animalCounts: Record<string, { count: number; positions: { x: number; y: number; z: number }[] }> = {};

    for (const entity of Object.values(bot.entities)) {
      if (entity === bot.entity) continue;
      if (!entity.position) continue;
      if (!entity.name || !FARMABLE_ANIMALS.includes(entity.name)) continue;

      const dist = entity.position.distanceTo(pos);
      if (dist > 32) continue;

      if (!animalCounts[entity.name]) {
        animalCounts[entity.name] = { count: 0, positions: [] };
      }
      animalCounts[entity.name].count++;
      animalCounts[entity.name].positions.push({
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z,
      });
    }

    for (const [animal, data] of Object.entries(animalCounts)) {
      if (data.count < 3) continue;
      const center = this.averagePosition(data.positions);
      out.push({
        type: 'animal',
        name: animal,
        position: center,
        value: 2,
        description: `Herd of ${data.count} ${animal}s nearby`,
        distance: 0,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private clusterPositions(positions: { x: number; y: number; z: number }[]): { center: { x: number; y: number; z: number }; count: number }[] {
    const used = new Set<number>();
    const clusters: { center: { x: number; y: number; z: number }; count: number }[] = [];

    for (let i = 0; i < positions.length; i++) {
      if (used.has(i)) continue;
      used.add(i);
      const members = [positions[i]];

      for (let j = i + 1; j < positions.length; j++) {
        if (used.has(j)) continue;
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        const dz = positions[i].z - positions[j].z;
        if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= CLUSTER_RADIUS) {
          used.add(j);
          members.push(positions[j]);
        }
      }

      clusters.push({
        center: this.averagePosition(members),
        count: members.length,
      });
    }

    return clusters;
  }

  private averagePosition(positions: { x: number; y: number; z: number }[]): { x: number; y: number; z: number } {
    let sx = 0, sy = 0, sz = 0;
    for (const p of positions) {
      sx += p.x;
      sy += p.y;
      sz += p.z;
    }
    const n = positions.length;
    return {
      x: Math.round(sx / n),
      y: Math.round(sy / n),
      z: Math.round(sz / n),
    };
  }

  private scoreItem(name: string): number {
    for (const [pattern, value] of ITEM_VALUE_MAP) {
      if (pattern.test(name)) return value;
    }
    return DEFAULT_ITEM_VALUE;
  }
}
