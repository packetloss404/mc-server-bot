import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

export interface Observation {
  biome: string;
  timeOfDay: string;
  health: number;
  hunger: number;
  position: string;
  equipment: string;
  inventory: string;
  inventorySlots: string;
  nearbyBlocks: string;
  nearbyEntities: string;
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

  // Nearby entities (sorted by distance)
  const nearbyEntities = getNearbyEntities(bot, 32);

  return {
    biome,
    timeOfDay,
    health: bot.health,
    hunger: bot.food,
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
Position: ${obs.position}
Equipment: ${obs.equipment}
Inventory (${obs.inventorySlots}): ${obs.inventory}
Nearby blocks: ${obs.nearbyBlocks}
Nearby entities: ${obs.nearbyEntities}`;
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
