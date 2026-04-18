import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { moveNearWithCleanup } from './moveHelper';
import { logger } from '../util/logger';

export interface ClearSiteOptions {
  /** World coordinates of the build footprint min corner */
  footprintMin: { x: number; y: number; z: number };
  /** World coordinates of the build footprint max corner */
  footprintMax: { x: number; y: number; z: number };
  /** Extra blocks of clearance around the footprint (default 2) */
  radius?: number;
  /** How high above footprint top to clear (default 6 to remove tree canopy) */
  clearanceHeight?: number;
  /** Replace surface water with dirt (default false) */
  removeWater?: boolean;
  /** Chop down logs and let leaves decay (default true) */
  fellTrees?: boolean;
  /** Cap on blocks to clear so a runaway clear doesn't lock the bot up (default 200) */
  maxBlocks?: number;
}

export interface ClearSiteResult {
  cleared: number;
  errors: string[];
}

const SURFACE_VEGETATION = new Set<string>([
  'tall_grass',
  'short_grass',
  'grass',
  'fern',
  'large_fern',
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'wither_rose',
  'dead_bush',
  'sweet_berry_bush',
]);

function isSapling(name: string): boolean {
  return name.endsWith('_sapling');
}

function isLog(name: string): boolean {
  // Covers oak_log, spruce_log, birch_log, jungle_log, acacia_log, dark_oak_log,
  // mangrove_log, cherry_log, and stripped variants.
  return name.endsWith('_log') || name.endsWith('_wood') ||
    name.startsWith('stripped_');
}

function isWater(name: string): boolean {
  return name === 'water' || name === 'flowing_water';
}

function inBox(
  p: { x: number; y: number; z: number },
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
): boolean {
  return (
    p.x >= min.x && p.x <= max.x &&
    p.y >= min.y && p.y <= max.y &&
    p.z >= min.z && p.z <= max.z
  );
}

function distance(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export async function clearSite(
  bot: Bot,
  opts: ClearSiteOptions,
): Promise<ClearSiteResult> {
  const radius = opts.radius ?? 2;
  const clearanceHeight = opts.clearanceHeight ?? 6;
  const removeWater = opts.removeWater ?? false;
  const fellTrees = opts.fellTrees !== false;
  const maxBlocks = opts.maxBlocks ?? 200;

  const clearMin = {
    x: Math.min(opts.footprintMin.x, opts.footprintMax.x) - radius,
    y: Math.min(opts.footprintMin.y, opts.footprintMax.y),
    z: Math.min(opts.footprintMin.z, opts.footprintMax.z) - radius,
  };
  const clearMax = {
    x: Math.max(opts.footprintMin.x, opts.footprintMax.x) + radius,
    y: Math.max(opts.footprintMin.y, opts.footprintMax.y) + clearanceHeight,
    z: Math.max(opts.footprintMin.z, opts.footprintMax.z) + radius,
  };
  const center = new Vec3(
    Math.floor((clearMin.x + clearMax.x) / 2),
    Math.floor((clearMin.y + clearMax.y) / 2),
    Math.floor((clearMin.z + clearMax.z) / 2),
  );

  const result: ClearSiteResult = { cleared: 0, errors: [] };

  logger.info(
    {
      botName: bot.username,
      clearMin,
      clearMax,
      radius,
      clearanceHeight,
      removeWater,
      fellTrees,
      maxBlocks,
    },
    'clearSite: starting site clear',
  );

  // Helper: dig a block at a position, moving close first if needed.
  const digAt = async (pos: Vec3, label: string): Promise<boolean> => {
    if (result.cleared >= maxBlocks) return false;
    const block = bot.blockAt(pos);
    if (!block) return false;
    // Recompute freshness — something upstream may have already cleared it
    // (e.g., leaf decay following a log chop).
    if (block.name === 'air' || block.name === 'cave_air') return false;

    try {
      const botPos = bot.entity?.position;
      if (botPos && distance(botPos, pos) > 4) {
        await moveNearWithCleanup(
          bot,
          { x: pos.x, y: pos.y, z: pos.z, range: 3 },
          8000,
        );
      }
      if (!bot.canDigBlock(block)) {
        // Might just be out of reach still — try once more.
        await moveNearWithCleanup(
          bot,
          { x: pos.x, y: pos.y, z: pos.z, range: 2 },
          5000,
        );
      }
      await bot.dig(block);
      result.cleared += 1;
      return true;
    } catch (err: any) {
      const msg = `dig failed for ${label} ${block.name} at ${pos.x},${pos.y},${pos.z}: ${err?.message ?? err}`;
      logger.warn({ botName: bot.username }, msg);
      result.errors.push(msg);
      return false;
    }
  };

  // 1) Tree felling
  if (fellTrees) {
    try {
      const logPositions = bot.findBlocks({
        point: center,
        matching: (block: any) => !!block && isLog(block.name) && inBox(block.position, clearMin, clearMax),
        maxDistance: 32,
        count: maxBlocks,
      });
      logger.info(
        { botName: bot.username, count: logPositions.length },
        'clearSite: felling logs',
      );
      for (const pos of logPositions) {
        if (result.cleared >= maxBlocks) break;
        await digAt(pos, 'log');
      }
    } catch (err: any) {
      const msg = `tree-felling scan failed: ${err?.message ?? err}`;
      logger.warn({ botName: bot.username }, msg);
      result.errors.push(msg);
    }
  }

  // 2) Surface vegetation
  if (result.cleared < maxBlocks) {
    try {
      const vegPositions = bot.findBlocks({
        point: center,
        matching: (block: any) => {
          if (!block) return false;
          const name = block.name;
          if (!(SURFACE_VEGETATION.has(name) || isSapling(name))) return false;
          return inBox(block.position, clearMin, clearMax);
        },
        maxDistance: 32,
        count: Math.max(1, maxBlocks - result.cleared),
      });
      logger.info(
        { botName: bot.username, count: vegPositions.length },
        'clearSite: clearing vegetation',
      );
      for (const pos of vegPositions) {
        if (result.cleared >= maxBlocks) break;
        await digAt(pos, 'vegetation');
      }
    } catch (err: any) {
      const msg = `vegetation scan failed: ${err?.message ?? err}`;
      logger.warn({ botName: bot.username }, msg);
      result.errors.push(msg);
    }
  }

  // 3) Surface water removal
  if (removeWater && result.cleared < maxBlocks) {
    const mcData = require('minecraft-data')(bot.version);
    const dirtItem = mcData.itemsByName['dirt'];

    // Restrict water scan to the footprint column, at the top y of the footprint.
    const footprintMinY = Math.min(opts.footprintMin.y, opts.footprintMax.y);
    const footprintMaxY = Math.max(opts.footprintMin.y, opts.footprintMax.y);
    const footprintMinX = Math.min(opts.footprintMin.x, opts.footprintMax.x);
    const footprintMaxX = Math.max(opts.footprintMin.x, opts.footprintMax.x);
    const footprintMinZ = Math.min(opts.footprintMin.z, opts.footprintMax.z);
    const footprintMaxZ = Math.max(opts.footprintMin.z, opts.footprintMax.z);

    try {
      const waterPositions = bot.findBlocks({
        point: new Vec3(
          Math.floor((footprintMinX + footprintMaxX) / 2),
          footprintMaxY,
          Math.floor((footprintMinZ + footprintMaxZ) / 2),
        ),
        matching: (block: any) => {
          if (!block || !isWater(block.name)) return false;
          const p = block.position;
          return (
            p.x >= footprintMinX && p.x <= footprintMaxX &&
            p.z >= footprintMinZ && p.z <= footprintMaxZ &&
            p.y >= footprintMinY && p.y <= footprintMaxY
          );
        },
        maxDistance: 32,
        count: Math.max(1, maxBlocks - result.cleared),
      });
      logger.info(
        { botName: bot.username, count: waterPositions.length },
        'clearSite: covering water with dirt',
      );

      for (const pos of waterPositions) {
        if (result.cleared >= maxBlocks) break;
        if (!dirtItem) {
          const msg = 'cannot remove water: minecraft-data has no dirt item';
          logger.warn({ botName: bot.username }, msg);
          result.errors.push(msg);
          break;
        }
        const dirtInInv = bot.inventory.findInventoryItem(dirtItem.id, null, false);
        if (!dirtInInv) {
          const msg = `cannot remove water at ${pos.x},${pos.y},${pos.z}: no dirt in inventory`;
          logger.warn({ botName: bot.username }, msg);
          result.errors.push(msg);
          break;
        }

        try {
          // Place dirt against a solid neighbor. Find a non-air, non-water
          // reference block adjacent to the water tile.
          const FACES: Vec3[] = [
            new Vec3(0, -1, 0),
            new Vec3(1, 0, 0),
            new Vec3(-1, 0, 0),
            new Vec3(0, 0, 1),
            new Vec3(0, 0, -1),
          ];

          const botPos = bot.entity?.position;
          if (botPos && distance(botPos, pos) > 4) {
            await moveNearWithCleanup(
              bot,
              { x: pos.x, y: pos.y, z: pos.z, range: 3 },
              8000,
            );
          }

          await bot.equip(dirtInInv, 'hand');

          let placed = false;
          let lastError = 'no solid reference block adjacent to water';
          for (const face of FACES) {
            const refPos = pos.offset(face.x, face.y, face.z);
            const refBlock = bot.blockAt(refPos);
            if (
              !refBlock ||
              refBlock.name === 'air' ||
              refBlock.name === 'cave_air' ||
              isWater(refBlock.name)
            ) {
              continue;
            }
            try {
              await bot.lookAt(pos);
              await bot.placeBlock(refBlock, new Vec3(-face.x, -face.y, -face.z));
              placed = true;
              result.cleared += 1;
              break;
            } catch (err: any) {
              lastError = `place dirt via ${refBlock.name}: ${err?.message ?? err}`;
            }
          }

          if (!placed) {
            const msg = `failed to cover water at ${pos.x},${pos.y},${pos.z}: ${lastError}`;
            logger.warn({ botName: bot.username }, msg);
            result.errors.push(msg);
          }
        } catch (err: any) {
          const msg = `water removal error at ${pos.x},${pos.y},${pos.z}: ${err?.message ?? err}`;
          logger.warn({ botName: bot.username }, msg);
          result.errors.push(msg);
        }
      }
    } catch (err: any) {
      const msg = `water scan failed: ${err?.message ?? err}`;
      logger.warn({ botName: bot.username }, msg);
      result.errors.push(msg);
    }
  }

  logger.info(
    {
      botName: bot.username,
      cleared: result.cleared,
      errorCount: result.errors.length,
    },
    'clearSite: done',
  );

  return result;
}
