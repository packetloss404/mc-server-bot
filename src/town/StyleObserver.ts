/**
 * StyleObserver — Phase 4 feedback path.
 *
 * After a building has been designed/cached, we summarize what was actually
 * built (block frequencies + dimensions) and:
 *
 *   1. Append a `style_observations` row via TownManager.
 *   2. Re-aggregate the recent observations into the on-disk `style.json` so
 *      future LLM design calls see the realized palette, not just the seed.
 *
 * The aggregation lives in StyleDoc.ts (`updateFromObservations`) — this
 * module is just the side-channel that captures one observation per build.
 */
import type { TownManager } from './TownManager';
import type { Town, Building } from './Town';
import type { BlockPlan } from './LlmDesigner';
import { updateFromObservations } from './StyleDoc';
import { logger } from '../util/logger';

/**
 * Top N blocks we track per role bucket. Keeps the observation payload tiny
 * and the style.json file stable across regenerations.
 */
const TOP_N = 6;

/**
 * Rough role-bucket inference from a block name. Reused by `updateFromObservations`
 * to roll many observations up into a {common/accent/roof/floor} palette.
 */
export function classifyBlock(name: string): 'roof' | 'floor' | 'wall' | 'accent' {
  const lc = name.toLowerCase().replace(/^minecraft:/, '');
  if (/_stairs|_slab$|^slab$/.test(lc) && !/^smooth_stone_slab$/.test(lc)) {
    // Slabs/stairs are usually roof or floor; "stairs" almost always roof.
    if (/_stairs$/.test(lc)) return 'roof';
  }
  if (/_slab$|^slab$/.test(lc)) return 'floor';
  if (/lantern|torch|banner|bookshelf|iron_block|gold_block|bell|chain|painting|item_frame|sign/.test(lc)) {
    return 'accent';
  }
  if (/_planks$|cobblestone|stone_bricks|^stone$|^andesite$|^granite$|^diorite$|^concrete$|polished_|smooth_/.test(lc)) {
    return 'wall';
  }
  return 'wall';
}

export interface StyleObservation {
  buildingId: string;
  kind: string;
  /** Dimensions in {w,h,d} — pulled straight from the BlockPlan. */
  dimensions: { w: number; h: number; d: number };
  /** Total block count for this building. */
  totalBlocks: number;
  /**
   * Block-name frequencies bucketed by role. Each list is top-N by count,
   * descending. Keeps the JSON small for the dashboard.
   */
  palette: {
    wall: Array<{ name: string; count: number }>;
    roof: Array<{ name: string; count: number }>;
    floor: Array<{ name: string; count: number }>;
    accent: Array<{ name: string; count: number }>;
  };
  observedAt: number;
}

/** Compute the palette frequency map from a BlockPlan. */
export function summarizePlan(plan: BlockPlan): StyleObservation['palette'] {
  const counts = {
    wall: new Map<string, number>(),
    roof: new Map<string, number>(),
    floor: new Map<string, number>(),
    accent: new Map<string, number>(),
  };
  for (const block of plan.blocks) {
    const bucket = classifyBlock(block.name);
    const map = counts[bucket];
    map.set(block.name, (map.get(block.name) ?? 0) + 1);
  }
  const topN = (map: Map<string, number>) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_N)
      .map(([name, count]) => ({ name, count }));
  return {
    wall: topN(counts.wall),
    roof: topN(counts.roof),
    floor: topN(counts.floor),
    accent: topN(counts.accent),
  };
}

export class StyleObserver {
  private readonly townManager: TownManager;
  private readonly dataDir: string;

  constructor(townManager: TownManager, dataDir: string) {
    this.townManager = townManager;
    this.dataDir = dataDir;
  }

  /**
   * Record a new style observation. Wrapped in try/catch — observation
   * persistence must never crash the brain tick.
   */
  observe(town: Town, building: Building, plan: BlockPlan): void {
    try {
      const observation: StyleObservation = {
        buildingId: building.id,
        kind: this.extractKind(building.name),
        dimensions: plan.dimensions,
        totalBlocks: plan.blocks.length,
        palette: summarizePlan(plan),
        observedAt: Date.now(),
      };
      this.townManager.insertStyleObservation(town.id, {
        buildingId: building.id,
        palette: observation,
      });
      // Re-aggregate the on-disk style doc from recent observations.
      updateFromObservations(this.dataDir, town.id, this.townManager.getStyleObservations(town.id));
      logger.debug(
        { townId: town.id, buildingId: building.id, kind: observation.kind, blocks: observation.totalBlocks },
        'StyleObserver: observation recorded',
      );
    } catch (err: any) {
      logger.warn(
        { err: err?.message, townId: town.id, buildingId: building.id },
        'StyleObserver.observe failed; continuing',
      );
    }
  }

  /** Pull the kind out of a `<kind>:<n>` building name. Defaults to 'unknown'. */
  private extractKind(name: string | null): string {
    if (!name) return 'unknown';
    const idx = name.indexOf(':');
    return idx > 0 ? name.slice(0, idx) : name;
  }
}
