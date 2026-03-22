import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { WorldMemory } from './WorldMemory';

export interface Blueprint {
  version: number;
  name: string;
  size: { x: number; y: number; z: number };
  palette: Record<string, string>;
  layers: string[][];
  defaultBlock?: string;
}

export interface BlueprintPlacement {
  x: number;
  y: number;
  z: number;
  block: string;
}

export interface BlueprintValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateBlueprint(bot: Bot, blueprint: Blueprint): BlueprintValidationResult {
  const errors: string[] = [];
  const mcData = require('minecraft-data')(bot.version);

  if (blueprint.version !== 1) {
    errors.push(`Unsupported blueprint version: ${blueprint.version}`);
  }

  if (!Number.isInteger(blueprint.size.x) || !Number.isInteger(blueprint.size.y) || !Number.isInteger(blueprint.size.z)) {
    errors.push('Blueprint size must use integer dimensions');
  }

  if (blueprint.size.x <= 0 || blueprint.size.y <= 0 || blueprint.size.z <= 0) {
    errors.push('Blueprint size must be positive');
  }

  if (blueprint.size.x > 15 || blueprint.size.y > 10 || blueprint.size.z > 15) {
    errors.push('Blueprint exceeds first-pass size limits (15x10x15)');
  }

  if (!blueprint.palette['.'] || blueprint.palette['.'] !== 'air') {
    errors.push('Blueprint palette must map "." to "air"');
  }

  if (!Array.isArray(blueprint.layers) || blueprint.layers.length !== blueprint.size.y) {
    errors.push(`Blueprint must contain exactly ${blueprint.size.y} layers`);
  }

  for (const [symbol, blockName] of Object.entries(blueprint.palette)) {
    if (symbol.length !== 1) {
      errors.push(`Palette key "${symbol}" must be a single character`);
    }
    if (!mcData.blocksByName[blockName] && blockName !== 'air' && blockName !== 'any_block') {
      errors.push(`Unknown block in palette: ${blockName}`);
    }
  }

  if (Object.values(blueprint.palette).includes('any_block') && !blueprint.defaultBlock) {
    errors.push('Blueprints using any_block must define defaultBlock');
  }

  for (let y = 0; y < blueprint.layers.length; y++) {
    const layer = blueprint.layers[y];
    if (!Array.isArray(layer) || layer.length !== blueprint.size.z) {
      errors.push(`Layer ${y} must contain exactly ${blueprint.size.z} rows`);
      continue;
    }
    for (let z = 0; z < layer.length; z++) {
      const row = layer[z];
      if (typeof row !== 'string' || row.length !== blueprint.size.x) {
        errors.push(`Layer ${y} row ${z} must be a string of length ${blueprint.size.x}`);
        continue;
      }
      for (const ch of row) {
        if (!(ch in blueprint.palette)) {
          errors.push(`Layer ${y} row ${z} uses unknown palette symbol: ${ch}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function countBlueprintMaterials(blueprint: Blueprint): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const layer of blueprint.layers) {
    for (const row of layer) {
      for (const ch of row) {
        let block = blueprint.palette[ch];
        if (block === 'any_block') block = blueprint.defaultBlock || 'oak_planks';
        if (!block || block === 'air') continue;
        counts[block] = (counts[block] || 0) + 1;
      }
    }
  }
  return counts;
}

export function generateSimpleHouseBlueprint(bot: Bot, request: string, worldMemory: WorldMemory): Blueprint {
  const material = chooseBuildMaterial(bot, request, worldMemory);
  const name = `${material}_simple_house`;
  const explicitMaterial = /(cobblestone|stone|birch|spruce|oak)/i.test(request);
  return {
    version: 1,
    name,
    size: { x: 5, y: 4, z: 5 },
    defaultBlock: material,
    palette: {
      '.': 'air',
      M: explicitMaterial ? material : 'any_block',
    },
    layers: [
      [
        'MMMMM',
        'MMMMM',
        'MMMMM',
        'MMMMM',
        'MMMMM',
      ],
      [
        'MMMMM',
        'M...M',
        'M...M',
        'M...M',
        'MM.MM',
      ],
      [
        'MMMMM',
        'M...M',
        'M...M',
        'M...M',
        'MM.MM',
      ],
      [
        'MMMMM',
        'MMMMM',
        'MMMMM',
        'MMMMM',
        'MMMMM',
      ],
    ],
  };
}

export function getMissingBlueprintPlacements(bot: Bot, blueprint: Blueprint, origin: { x: number; y: number; z: number }): BlueprintPlacement[] {
  const missing: BlueprintPlacement[] = [];
  for (let y = 0; y < blueprint.layers.length; y++) {
    const layer = blueprint.layers[y];
    for (let z = 0; z < layer.length; z++) {
      const row = layer[z];
      for (let x = 0; x < row.length; x++) {
        const symbol = row[x];
        const worldPos = { x: origin.x + x, y: origin.y + y, z: origin.z + z };
        let block = blueprint.palette[symbol];
        if (block === 'any_block') {
          const existingSolid = bot.blockAt(new Vec3(worldPos.x, worldPos.y, worldPos.z));
          if (existingSolid && !['air', 'cave_air', 'void_air'].includes(existingSolid.name)) {
            continue;
          }
          block = blueprint.defaultBlock || 'oak_planks';
        }
        if (!block || block === 'air') continue;
        const existing = bot.blockAt(new Vec3(worldPos.x, worldPos.y, worldPos.z));
        if (!existing || existing.name !== block) {
          missing.push({ ...worldPos, block });
        }
      }
    }
  }
  return missing.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
}

function chooseBuildMaterial(bot: Bot, request: string, worldMemory: WorldMemory): string {
  const lower = request.toLowerCase();
  if (lower.includes('cobblestone') || lower.includes('stone')) return 'cobblestone';
  if (lower.includes('birch')) return 'birch_planks';
  if (lower.includes('spruce')) return 'spruce_planks';
  if (lower.includes('oak')) return 'oak_planks';

  const counts = new Map<string, number>();
  for (const item of bot.inventory.items()) {
    counts.set(item.name, (counts.get(item.name) || 0) + item.count);
  }
  const scored: Array<{ material: string; score: number }> = [
    { material: 'oak_planks', score: (counts.get('oak_planks') || 0) + (counts.get('oak_log') || 0) * 4 + (worldMemory.findNearest('oak_log', 'resource') ? 12 : 0) },
    { material: 'spruce_planks', score: (counts.get('spruce_planks') || 0) + (counts.get('spruce_log') || 0) * 4 },
    { material: 'birch_planks', score: (counts.get('birch_planks') || 0) + (counts.get('birch_log') || 0) * 4 },
    { material: 'cobblestone', score: (counts.get('cobblestone') || 0) + (counts.get('stone') || 0) + 4 },
  ].sort((a, b) => b.score - a.score);
  return scored[0]?.material || 'oak_planks';
}
