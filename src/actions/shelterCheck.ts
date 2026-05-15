import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/**
 * Result of a shelter validation check.
 *
 * `safe` is true only when the bot has a solid block directly above it and
 * all four cardinal sides are walled at both eye-level and floor-level. Light
 * level is reported for diagnostics but is intentionally not part of the gate,
 * since some servers/versions don't expose `block.light` on the client side.
 */
export interface ShelterStatus {
  safe: boolean;
  hasRoof: boolean;
  wallsCovered: number;
  exposedSides: string[];
  lightLevel: number;
  reason: string;
}

interface CardinalOffset {
  label: 'north' | 'south' | 'east' | 'west';
  dx: number;
  dz: number;
}

// Minecraft convention: -Z is north, +Z is south, +X is east, -X is west.
const CARDINALS: CardinalOffset[] = [
  { label: 'north', dx: 0, dz: -1 },
  { label: 'south', dx: 0, dz: 1 },
  { label: 'east', dx: 1, dz: 0 },
  { label: 'west', dx: -1, dz: 0 },
];

function isSolidBlock(block: any): boolean {
  if (!block) return false;
  if (block.boundingBox === 'block') return true;
  return false;
}

/**
 * Validate whether the bot is actually inside a sealed shelter.
 *
 * Checks a roof block at (bot.y + 2) and the four cardinal neighbors at both
 * the eye-level row (bot.y + 1) and the floor row (bot.y). A "wall" requires
 * both rows on that side to be solid — half-walls or single-block fences
 * count as exposed.
 */
export function checkShelter(bot: Bot): ShelterStatus {
  // Defensive fallbacks so the function is safe to call even when bot.entity
  // isn't ready yet (e.g. just-spawned bot, mid-respawn).
  const entity = (bot as any).entity;
  if (!entity || !entity.position) {
    return {
      safe: false,
      hasRoof: false,
      wallsCovered: 0,
      exposedSides: ['north', 'south', 'east', 'west'],
      lightLevel: 0,
      reason: 'Bot has no entity/position — cannot check shelter',
    };
  }

  const pos: Vec3 = entity.position.floored
    ? entity.position.floored()
    : new Vec3(Math.floor(entity.position.x), Math.floor(entity.position.y), Math.floor(entity.position.z));

  // Roof: solid block directly above the bot's head (y + 2 relative to feet).
  const roofPos = pos.offset(0, 2, 0);
  const roofBlock = bot.blockAt(roofPos);
  const hasRoof = isSolidBlock(roofBlock);

  const exposedSides: string[] = [];
  let wallsCovered = 0;

  for (const c of CARDINALS) {
    const eyePos = pos.offset(c.dx, 1, c.dz);
    const floorPos = pos.offset(c.dx, 0, c.dz);
    const eyeBlock = bot.blockAt(eyePos);
    const floorBlock = bot.blockAt(floorPos);
    const eyeSolid = isSolidBlock(eyeBlock);
    const floorSolid = isSolidBlock(floorBlock);
    if (eyeSolid && floorSolid) {
      wallsCovered += 1;
    } else {
      exposedSides.push(c.label);
    }
  }

  // Light level — read defensively. Some servers/versions don't expose `light`
  // on prismarine-block, in which case we treat it as 0 (unknown). It is
  // informational only and never blocks the `safe` gate.
  let lightLevel = 0;
  try {
    const here = bot.blockAt(pos) as any;
    const raw = here?.light;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      lightLevel = Math.max(0, Math.min(15, raw));
    }
  } catch {
    lightLevel = 0;
  }

  const safe = hasRoof && wallsCovered === 4;

  let reason: string;
  if (safe) {
    reason = `Fully enclosed: roof present, all 4 walls solid (light ${lightLevel})`;
  } else if (!hasRoof && wallsCovered === 0) {
    reason = 'Open air — no roof and no walls';
  } else if (!hasRoof) {
    reason = `Missing roof (${wallsCovered}/4 walls covered, exposed: ${exposedSides.join(', ') || 'none'})`;
  } else {
    reason = `Incomplete walls: ${wallsCovered}/4 covered, exposed sides: ${exposedSides.join(', ')}`;
  }

  return {
    safe,
    hasRoof,
    wallsCovered,
    exposedSides,
    lightLevel,
    reason,
  };
}
