import fs from 'fs';
import path from 'path';
import { logger } from '../util/logger';

/** One queued gather task in the autoGather pre-stage. */
export interface GatherPlanEntry {
  botName: string;
  resource: string;
  chunkSize: number;
  description: string;
  skillFile: string;
}

export interface SkillChunk {
  resource: string;
  chunkSize: number;
  skillFile: string;
  description: string;
}

/** Safety cap on the number of gather chunks queued in one plan. */
const AUTOGATHER_MAX_CHUNKS = 50;

/** Strip a `minecraft:` namespace prefix and normalize to lowercase. */
export function normalizeResource(name: string): string {
  if (!name) return '';
  const n = name.toLowerCase();
  return n.startsWith('minecraft:') ? n.slice('minecraft:'.length) : n;
}

/**
 * Pure planning core of the autoGather pre-stage, extracted from
 * BuildCoordinator (review: decomposition). Owns skill-catalog discovery, the
 * per-material requirement computation, and the chunk plan. It reads bot
 * inventories through an injected provider so it stays decoupled from
 * BotManager. The orchestration (dispatch + readiness polling) stays on the
 * coordinator since it mutates build-job state.
 */
export class GatherPlanner {
  private skillChunkCatalog: Map<string, SkillChunk> | null = null;

  constructor(private readonly inventoryProvider: (botName: string) => Map<string, number>) {}

  /**
   * Discover gather-skill chunk sizes by reading `skills/` filenames. Each
   * `(mine|craft)_<N>_<resource>(_suffix)?.js` is parsed; we retain the LARGEST
   * chunk size per resource. Cached in-memory; pass `force` to re-scan.
   */
  getSkillChunkCatalog(force = false): Map<string, SkillChunk> {
    if (this.skillChunkCatalog && !force) return this.skillChunkCatalog;

    const catalog = new Map<string, SkillChunk>();
    const skillsDir = path.join(process.cwd(), 'skills');
    let files: string[] = [];
    try {
      files = fs.readdirSync(skillsDir).filter((f) => f.endsWith('.js'));
    } catch (err: any) {
      logger.warn({ err: err.message, skillsDir }, 'autoGather: skills/ unreadable, catalog empty');
      this.skillChunkCatalog = catalog;
      return catalog;
    }

    const re = /^(mine|craft)_(\d+)_([a-z0-9_]+?)(?:_(?:from|using|to|at|the|in|near|with|nearby|more|of|by)(?:_.*)?)?\.js$/;
    for (const file of files) {
      const m = re.exec(file);
      if (!m) continue;
      const verb = m[1];
      const n = parseInt(m[2], 10);
      if (!Number.isFinite(n) || n <= 0) continue;
      let resource = m[3];

      resource = resource.replace(/^(oak|spruce|birch|jungle|acacia|dark_oak|cherry|mangrove)(planks|log|logs|door|fence|stairs|slab)$/,
        (_full, wood, suffix) => `${wood}_${suffix}`);
      resource = resource.replace(/_blocks?$/, '');
      resource = resource.replace(/^(blocks?_of_|more_)/, '');

      const variants = new Set<string>([resource]);
      if (resource.endsWith('s') && !resource.endsWith('ss')) {
        variants.add(resource.slice(0, -1));
      } else {
        variants.add(`${resource}s`);
      }

      for (const r of variants) {
        const existing = catalog.get(r);
        if (!existing || existing.chunkSize < n) {
          const verbWord = verb === 'mine' ? 'Mine' : 'Craft';
          catalog.set(r, { resource: r, chunkSize: n, skillFile: file, description: `${verbWord} ${n} ${resource}` });
        }
      }
    }

    this.skillChunkCatalog = catalog;
    logger.info({ resources: catalog.size }, 'autoGather: skill chunk catalog built');
    return catalog;
  }

  /**
   * Per-material requirement for a schematic from its block list. Returns a map
   * keyed by NORMALIZED block name (no `minecraft:` prefix).
   */
  computeMaterialRequirement(blocks: ReadonlyArray<{ name: string }>): Map<string, number> {
    const req = new Map<string, number>();
    for (const b of blocks) {
      const key = normalizeResource(b.name);
      if (!key) continue;
      req.set(key, (req.get(key) ?? 0) + 1);
    }
    return req;
  }

  /**
   * Build the chunk plan: for each (bot, material) with a positive shortfall,
   * find the largest available chunk skill and queue floor(shortage/chunk)+1
   * chunks. Caps at AUTOGATHER_MAX_CHUNKS. Also returns each bot's share of the
   * requirement so the readiness check can compare per-bot.
   */
  planGather(
    botNames: string[],
    requirement: Map<string, number>,
  ): { plan: GatherPlanEntry[]; perBotTarget: Map<string, Map<string, number>> } {
    const catalog = this.getSkillChunkCatalog();
    const plan: GatherPlanEntry[] = [];
    const perBotTarget = new Map<string, Map<string, number>>();
    if (botNames.length === 0) return { plan, perBotTarget };

    const share = (total: number, n: number) => Math.ceil(total / Math.max(1, n));

    for (const bot of botNames) {
      perBotTarget.set(bot, new Map());
    }
    for (const [material, total] of requirement.entries()) {
      const per = share(total, botNames.length);
      for (const bot of botNames) {
        perBotTarget.get(bot)!.set(material, per);
      }
    }

    let queued = 0;
    for (const bot of botNames) {
      if (queued >= AUTOGATHER_MAX_CHUNKS) break;
      const inv = this.inventoryProvider(bot);
      const targets = perBotTarget.get(bot)!;
      for (const [material, target] of targets.entries()) {
        if (queued >= AUTOGATHER_MAX_CHUNKS) break;
        const have = inv.get(material) ?? 0;
        const shortage = target - have;
        if (shortage <= 0) continue;
        const chunk =
          catalog.get(material) ??
          (material.endsWith('s') ? catalog.get(material.slice(0, -1)) : catalog.get(`${material}s`));
        if (!chunk) {
          logger.debug({ bot, material, shortage }, 'autoGather: no skill chunk found for material — skipping');
          continue;
        }
        const chunks = Math.floor(shortage / chunk.chunkSize) + 1;
        for (let i = 0; i < chunks; i++) {
          if (queued >= AUTOGATHER_MAX_CHUNKS) break;
          plan.push({
            botName: bot,
            resource: chunk.resource,
            chunkSize: chunk.chunkSize,
            description: chunk.description,
            skillFile: chunk.skillFile,
          });
          queued++;
        }
      }
    }

    return { plan, perBotTarget };
  }
}
