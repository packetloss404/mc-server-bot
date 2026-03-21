import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

export interface Observation {
  biome: string;
  timeOfDay: string;
  health: number;
  hunger: number;
  oxygen: number;
  position: string;
  equipment: string;
  inventory: string;
  inventorySlots: string;
  nearbyBlocks: string;
  nearbyEntities: string;
  knownLocations?: string;
}

export function renderObservation(bot: Bot): Observation {
  const pos = bot.entity.position;

  // Biome
  let biome = 'unknown';
  try {
    const block = bot.blockAt(pos);
    if (block && (block as any).biome) {
      biome = String((block as any).biome.name || 'unknown');
    }
  } catch { /* ignore */ }

  // Time
  const timeOfDay = bot.time.timeOfDay < 6000 ? 'sunrise'
    : bot.time.timeOfDay < 12000 ? 'day'
    : bot.time.timeOfDay < 18000 ? 'sunset'
    : 'night';

  // Equipment
  const heldItem = bot.heldItem;
  const equipment = heldItem ? `${heldItem.name} x${heldItem.count}` : 'empty hand';

  // Inventory
  const items = bot.inventory.items();
  const inventoryLines = items.length > 0
    ? items.map((i) => `${i.name} x${i.count}`).join(', ')
    : 'empty';
  const inventorySlots = `${items.length}/36`;

  // Nearby blocks (scan for unique block types within 16 blocks)
  const nearbyBlocks = getNearbyBlocks(bot, 16);

  // Override biome to "underground" if no surface blocks are nearby (matches original Voyager)
  const surfaceIndicators = ['dirt', 'grass_block', 'sand', 'snow', 'snow_block'];
  const blockList = nearbyBlocks.split(', ');
  if (biome !== 'unknown' && !blockList.some((b) => surfaceIndicators.some((s) => b.includes(s))) && !nearbyBlocks.includes('log')) {
    biome = 'underground';
  }

  // Nearby entities (sorted by distance)
  const nearbyEntities = getNearbyEntities(bot, 32);

  return {
    biome,
    timeOfDay,
    health: bot.health,
    hunger: bot.food,
    oxygen: (bot.entity as any).oxygenLevel ?? 300,
    position: `${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}`,
    equipment,
    inventory: inventoryLines,
    inventorySlots,
    nearbyBlocks,
    nearbyEntities,
  };
}

export function formatObservation(obs: Observation): string {
  return `Biome: ${obs.biome}
Time: ${obs.timeOfDay}
Health: ${obs.health}/20
Hunger: ${obs.hunger}/20
Oxygen: ${obs.oxygen}
Position: ${obs.position}
Equipment: ${obs.equipment}
Inventory (${obs.inventorySlots}): ${obs.inventory}
Nearby blocks: ${obs.nearbyBlocks}
Nearby entities: ${obs.nearbyEntities}`;
}

/**
 * Warm-up thresholds for curriculum observation fields.
 * Matches original Voyager's graduated observation system.
 * Fields with threshold 0 are always shown; others are gated by completedTaskCount
 * and have an 80% stochastic inclusion chance once unlocked.
 */
const WARMUP_THRESHOLDS: Record<string, number> = {
  nearbyBlocks: 0,     // always — essential for early mining tasks
  position: 0,         // always — needed for movement tasks
  equipment: 0,        // always — what the bot is holding
  inventory: 0,        // always — core decision driver
  completedTasks: 0,   // always — avoid repeats
  failedTasks: 0,      // always — avoid retrying broken tasks
  nearbyEntities: 5,   // after 5 tasks — combat/social awareness
  biome: 10,           // after 10 tasks — biome-specific resources
  time: 15,            // after 15 tasks — day/night cycle awareness
  health: 15,          // after 15 tasks — survival awareness
  hunger: 15,          // after 15 tasks — food management
  oxygen: 20,          // after 20 tasks — underwater exploration
  context: 15,         // after 15 tasks — QA context
};

/** Core inventory items shown before the optional_inventory threshold. */
const CORE_INVENTORY_REGEX = /log|plank|stick|pickaxe|axe|hoe|sword|shovel|crafting_table|furnace|cobblestone|stone|iron|coal|diamond|gold|wheat|bread|seed/i;

/**
 * Format observation with graduated field inclusion based on how many tasks
 * the bot has completed. Early on, only essential fields are shown to prevent
 * information overload and keep the curriculum focused on basics.
 */
export function formatObservationWithWarmup(obs: Observation, completedTaskCount: number): string {
  const lines: string[] = [];

  if (shouldInclude('nearbyBlocks', completedTaskCount)) {
    lines.push(`Nearby blocks: ${obs.nearbyBlocks}`);
  }
  if (shouldInclude('position', completedTaskCount)) {
    lines.push(`Position: ${obs.position}`);
  }
  if (shouldInclude('equipment', completedTaskCount)) {
    lines.push(`Equipment: ${obs.equipment}`);
  }
  if (shouldInclude('inventory', completedTaskCount)) {
    // Filter inventory to core items early on
    const inventoryStr = completedTaskCount < 7
      ? filterCoreInventory(obs.inventory)
      : obs.inventory;
    lines.push(`Inventory (${obs.inventorySlots}): ${inventoryStr}`);
  }
  if (shouldInclude('nearbyEntities', completedTaskCount)) {
    lines.push(`Nearby entities: ${obs.nearbyEntities}`);
  }
  if (shouldInclude('biome', completedTaskCount)) {
    lines.push(`Biome: ${obs.biome}`);
  }
  if (shouldInclude('time', completedTaskCount)) {
    lines.push(`Time: ${obs.timeOfDay}`);
  }
  if (shouldInclude('health', completedTaskCount)) {
    lines.push(`Health: ${obs.health}/20`);
  }
  if (shouldInclude('hunger', completedTaskCount)) {
    lines.push(`Hunger: ${obs.hunger}/20`);
  }
  if (shouldInclude('oxygen', completedTaskCount)) {
    lines.push(`Oxygen: ${obs.oxygen}`);
  }

  return lines.join('\n');
}

/** Check if the QA context warm-up threshold has been met. */
export function isContextWarmedUp(completedTaskCount: number): boolean {
  return completedTaskCount >= WARMUP_THRESHOLDS.context;
}

function shouldInclude(field: string, completedTaskCount: number): boolean {
  const threshold = WARMUP_THRESHOLDS[field] ?? 0;
  if (completedTaskCount < threshold) return false;
  // Fields with threshold 0 are always included; others have 80% stochastic inclusion
  if (threshold === 0) return true;
  return Math.random() < 0.8;
}

function filterCoreInventory(inventory: string): string {
  if (inventory === 'empty') return inventory;
  const items = inventory.split(', ');
  const filtered = items.filter((item) => CORE_INVENTORY_REGEX.test(item));
  return filtered.length > 0 ? filtered.join(', ') : inventory;
}

function getNearbyBlocks(bot: Bot, radius: number): string {
  const pos = bot.entity.position;
  const blockCounts: Record<string, number> = {};

  // Sample blocks in a grid pattern
  for (let dx = -radius; dx <= radius; dx += 4) {
    for (let dy = -4; dy <= 8; dy += 2) {
      for (let dz = -radius; dz <= radius; dz += 4) {
        try {
          const block = bot.blockAt(pos.offset(dx, dy, dz));
          if (block && block.name !== 'air' && block.name !== 'cave_air') {
            blockCounts[block.name] = (blockCounts[block.name] || 0) + 1;
          }
        } catch { /* ignore */ }
      }
    }
  }

  // Sort by count, take top 15
  const sorted = Object.entries(blockCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => name);

  return sorted.length > 0 ? sorted.join(', ') : 'none visible';
}

function getNearbyEntities(bot: Bot, radius: number): string {
  const pos = bot.entity.position;
  const entities: { name: string; dist: number; type: string }[] = [];

  for (const entity of Object.values(bot.entities)) {
    if (entity === bot.entity) continue;
    if (!entity.position) continue;

    const dist = entity.position.distanceTo(pos);
    if (dist > radius) continue;

    const name = entity.type === 'player'
      ? `player:${(entity as any).username || 'unknown'}`
      : entity.name || entity.type || 'unknown';

    entities.push({ name, dist: Math.round(dist), type: entity.type || 'unknown' });
  }

  // Sort by distance, take top 10
  entities.sort((a, b) => a.dist - b.dist);
  const top = entities.slice(0, 10);

  return top.length > 0
    ? top.map((e) => `${e.name} (${e.dist}m)`).join(', ')
    : 'none';
}
