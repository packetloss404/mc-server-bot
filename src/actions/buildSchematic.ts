import fs from 'fs';
import path from 'path';
import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { goals } from 'mineflayer-pathfinder';
import { ActionResult } from './types';
import { logger } from '../util/logger';

/**
 * Loads a .schematic or .schem file and builds it block-by-block
 * at the specified origin position (or the bot's current position).
 */
export async function buildSchematic(
  bot: Bot,
  schematicPath: string,
  origin?: { x: number; y: number; z: number },
  onProgress?: (placed: number, total: number) => void
): Promise<ActionResult> {
  const { Schematic } = require('prismarine-schematic');

  // Resolve path relative to schematics directory
  const fullPath = path.isAbsolute(schematicPath)
    ? schematicPath
    : path.join(process.cwd(), 'schematics', schematicPath);

  if (!fs.existsSync(fullPath)) {
    return { success: false, message: `Schematic file not found: ${fullPath}` };
  }

  const buffer = fs.readFileSync(fullPath);
  let schematic: any;
  try {
    schematic = await Schematic.read(buffer, bot.version);
  } catch (err: any) {
    return { success: false, message: `Failed to parse schematic: ${err.message}` };
  }

  const size = schematic.size;
  logger.info({ size: { x: size.x, y: size.y, z: size.z } }, 'Schematic loaded');

  // Origin defaults to bot's current position
  const basePos = origin
    ? new Vec3(origin.x, origin.y, origin.z)
    : bot.entity.position.floored();

  // Collect all non-air blocks, sorted bottom-up (Y ascending) for structural integrity
  const blocks: { pos: Vec3; name: string; properties: Record<string, string> }[] = [];
  const start = schematic.start();
  const end = schematic.end();

  for (let y = start.y; y <= end.y; y++) {
    for (let z = start.z; z <= end.z; z++) {
      for (let x = start.x; x <= end.x; x++) {
        const localPos = new Vec3(x, y, z);
        const block = schematic.getBlock(localPos);
        if (block && block.name !== 'air' && block.name !== 'cave_air' && block.name !== 'void_air') {
          blocks.push({
            pos: basePos.plus(localPos).minus(start),
            name: block.name,
            properties: block.getProperties ? block.getProperties() : {},
          });
        }
      }
    }
  }

  const total = blocks.length;
  if (total === 0) {
    return { success: false, message: 'Schematic contains no blocks' };
  }

  logger.info({ total, origin: { x: basePos.x, y: basePos.y, z: basePos.z } }, 'Starting schematic build');

  const mcData = require('minecraft-data')(bot.version);
  let placed = 0;
  let failed = 0;

  for (const block of blocks) {
    try {
      // Walk near if too far
      const dist = bot.entity.position.distanceTo(block.pos);
      if (dist > 4) {
        bot.pathfinder.setGoal(new goals.GoalNear(block.pos.x, block.pos.y, block.pos.z, 3));
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => { bot.pathfinder.stop(); resolve(); }, 10000);
          bot.once('goal_reached', () => { clearTimeout(timeout); resolve(); });
        });
      }

      // Find the block item in inventory
      const blockItem = mcData.itemsByName[block.name];
      if (!blockItem) {
        // Try using setblock command as fallback
        const stateStr = Object.entries(block.properties)
          .map(([k, v]) => `${k}=${v}`)
          .join(',');
        const blockSpec = stateStr ? `${block.name}[${stateStr}]` : block.name;
        bot.chat(`/setblock ${block.pos.x} ${block.pos.y} ${block.pos.z} minecraft:${blockSpec} replace`);
        await new Promise((r) => setTimeout(r, 50));
        placed++;
        if (onProgress && placed % 50 === 0) onProgress(placed, total);
        continue;
      }

      // Check if we have the item
      const item = bot.inventory.findInventoryItem(blockItem.id, null, false);
      if (!item) {
        // Fall back to setblock command
        bot.chat(`/setblock ${block.pos.x} ${block.pos.y} ${block.pos.z} minecraft:${block.name} replace`);
        await new Promise((r) => setTimeout(r, 50));
        placed++;
        if (onProgress && placed % 50 === 0) onProgress(placed, total);
        continue;
      }

      // Place manually
      await bot.equip(item, 'hand');
      const refBlock = bot.blockAt(block.pos.offset(0, -1, 0));
      if (refBlock) {
        await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
      }
      placed++;
      if (onProgress && placed % 50 === 0) onProgress(placed, total);
    } catch (err: any) {
      // Fall back to setblock on any error
      try {
        bot.chat(`/setblock ${block.pos.x} ${block.pos.y} ${block.pos.z} minecraft:${block.name} replace`);
        await new Promise((r) => setTimeout(r, 50));
        placed++;
      } catch {
        failed++;
      }
      if (onProgress && placed % 50 === 0) onProgress(placed, total);
    }
  }

  const msg = `Build complete: ${placed}/${total} blocks placed${failed > 0 ? `, ${failed} failed` : ''}`;
  logger.info({ placed, total, failed }, msg);
  return { success: placed > 0, message: msg };
}

/**
 * Lists available schematic files in the schematics directory.
 */
export function listSchematics(): string[] {
  const dir = path.join(process.cwd(), 'schematics');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.schem') || f.endsWith('.schematic'));
}
