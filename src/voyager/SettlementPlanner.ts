import { logger } from '../util/logger';

export type ZoneType =
  | 'town_center'
  | 'residential'
  | 'farming'
  | 'mining'
  | 'guard_tower'
  | 'storage'
  | 'workshop'
  | 'market'
  | 'park';

export interface Zone {
  id: string;
  type: ZoneType;
  center: { x: number; y: number; z: number };
  radius: number;
  assignedBots: string[];
  structures: Structure[];
  status: 'planned' | 'in_progress' | 'completed';
  priority: number;
}

export interface Structure {
  id: string;
  name: string;
  type: string;
  position: { x: number; y: number; z: number };
  dimensions: { width: number; height: number; depth: number };
  materials: Record<string, number>;
  status: 'planned' | 'gathering' | 'building' | 'completed';
  assignedBot?: string;
}

export interface SettlementPlan {
  id: string;
  name: string;
  center: { x: number; y: number; z: number };
  zones: Zone[];
  buildOrder: string[];
  status: 'planning' | 'active' | 'completed';
  createdAt: number;
}

/* ---------- material templates ---------- */

const MATERIAL_TEMPLATES: Record<string, Record<string, number>> = {
  house:        { oak_planks: 64, cobblestone: 32, glass: 3, oak_door: 1 },
  farm:         { dirt: 32, water_bucket: 4, wheat_seeds: 16 },
  tower:        { cobblestone: 128, oak_planks: 16, torch: 4 },
  wall_segment: { cobblestone: 64 },
  chest_room:   { oak_planks: 48, chest: 6 },
  furnace_room: { cobblestone: 32, furnace: 4 },
};

const DIMENSION_TEMPLATES: Record<string, { width: number; height: number; depth: number }> = {
  house:        { width: 7, height: 5, depth: 7 },
  farm:         { width: 9, height: 2, depth: 9 },
  tower:        { width: 5, height: 10, depth: 5 },
  wall_segment: { width: 16, height: 4, depth: 1 },
  chest_room:   { width: 7, height: 4, depth: 5 },
  furnace_room: { width: 5, height: 4, depth: 5 },
  sign:         { width: 1, height: 2, depth: 1 },
  trade_hub:    { width: 5, height: 3, depth: 5 },
};

/* ---------- build-order priority map ---------- */

const ZONE_PRIORITY: Record<ZoneType, number> = {
  town_center:  0,
  storage:      1,
  workshop:     2,
  farming:      3,
  residential:  4,
  guard_tower:  5,
  mining:       6,
  market:       7,
  park:         8,
};

/* ---------- personality → zone mapping ---------- */

const PERSONALITY_ZONE: Record<string, ZoneType | null> = {
  farmer:     'farming',
  guard:      'guard_tower',
  blacksmith: 'workshop',
  merchant:   'market',
  explorer:   null,          // roaming — not assigned
  elder:      'town_center',
};

/* ---------- helpers ---------- */

let nextId = 0;
function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(nextId++).toString(36)}`;
}

function offsetPos(
  center: { x: number; y: number; z: number },
  dx: number,
  dz: number,
): { x: number; y: number; z: number } {
  return { x: center.x + dx, y: center.y, z: center.z + dz };
}

function makeStructure(
  name: string,
  type: string,
  position: { x: number; y: number; z: number },
): Structure {
  const dims = DIMENSION_TEMPLATES[type] ?? { width: 5, height: 4, depth: 5 };
  const mats = MATERIAL_TEMPLATES[type] ?? {};
  return {
    id: uid('struct'),
    name,
    type,
    position,
    dimensions: { ...dims },
    materials: { ...mats },
    status: 'planned',
  };
}

/* ---------- zone generators ---------- */

function townCenterZone(center: { x: number; y: number; z: number }): Zone {
  const structures: Structure[] = [
    makeStructure('Task Board', 'sign', center),
    makeStructure('Trade Hub', 'trade_hub', offsetPos(center, 4, 0)),
  ];
  return {
    id: uid('zone'),
    type: 'town_center',
    center,
    radius: 8,
    assignedBots: [],
    structures,
    status: 'planned',
    priority: ZONE_PRIORITY.town_center,
  };
}

function storageZone(center: { x: number; y: number; z: number }): Zone {
  return {
    id: uid('zone'),
    type: 'storage',
    center: offsetPos(center, 20, 0),
    radius: 8,
    assignedBots: [],
    structures: [makeStructure('Storage Room', 'chest_room', offsetPos(center, 20, 0))],
    status: 'planned',
    priority: ZONE_PRIORITY.storage,
  };
}

function workshopZone(center: { x: number; y: number; z: number }): Zone {
  return {
    id: uid('zone'),
    type: 'workshop',
    center: offsetPos(center, -20, 0),
    radius: 8,
    assignedBots: [],
    structures: [makeStructure('Furnace Room', 'furnace_room', offsetPos(center, -20, 0))],
    status: 'planned',
    priority: ZONE_PRIORITY.workshop,
  };
}

function residentialZone(
  center: { x: number; y: number; z: number },
  botCount: number,
): Zone {
  const houses: Structure[] = [];
  const houseCount = Math.max(1, botCount);
  const angleStep = (2 * Math.PI) / houseCount;
  const ringR = 32;

  for (let i = 0; i < houseCount; i++) {
    const angle = angleStep * i;
    const dx = Math.round(ringR * Math.cos(angle));
    const dz = Math.round(ringR * Math.sin(angle));
    houses.push(makeStructure(`House ${i + 1}`, 'house', offsetPos(center, dx, dz)));
  }

  return {
    id: uid('zone'),
    type: 'residential',
    center: offsetPos(center, 0, 32),
    radius: 16,
    assignedBots: [],
    structures: houses,
    status: 'planned',
    priority: ZONE_PRIORITY.residential,
  };
}

function farmingZone(
  center: { x: number; y: number; z: number },
  farmCount: number,
): Zone {
  const farms: Structure[] = [];
  const angleStep = (2 * Math.PI) / Math.max(1, farmCount);
  const ringR = 48;

  for (let i = 0; i < farmCount; i++) {
    const angle = angleStep * i;
    const dx = Math.round(ringR * Math.cos(angle));
    const dz = Math.round(ringR * Math.sin(angle));
    farms.push(makeStructure(`Farm Plot ${i + 1}`, 'farm', offsetPos(center, dx, dz)));
  }

  return {
    id: uid('zone'),
    type: 'farming',
    center: offsetPos(center, 0, -48),
    radius: 16,
    assignedBots: [],
    structures: farms,
    status: 'planned',
    priority: ZONE_PRIORITY.farming,
  };
}

function guardTowerZone(center: { x: number; y: number; z: number }, withWalls: boolean): Zone {
  const structures: Structure[] = [
    makeStructure('North Tower', 'tower', offsetPos(center, 0, -64)),
    makeStructure('South Tower', 'tower', offsetPos(center, 0, 64)),
    makeStructure('East Tower', 'tower', offsetPos(center, 64, 0)),
    makeStructure('West Tower', 'tower', offsetPos(center, -64, 0)),
  ];

  if (withWalls) {
    // 4 wall segments connecting adjacent towers (approximation: one segment per side)
    structures.push(makeStructure('North Wall', 'wall_segment', offsetPos(center, 32, -64)));
    structures.push(makeStructure('South Wall', 'wall_segment', offsetPos(center, -32, 64)));
    structures.push(makeStructure('East Wall', 'wall_segment', offsetPos(center, 64, 32)));
    structures.push(makeStructure('West Wall', 'wall_segment', offsetPos(center, -64, -32)));
  }

  return {
    id: uid('zone'),
    type: 'guard_tower',
    center,
    radius: 64,
    assignedBots: [],
    structures,
    status: 'planned',
    priority: ZONE_PRIORITY.guard_tower,
  };
}

function miningZone(center: { x: number; y: number; z: number }): Zone {
  return {
    id: uid('zone'),
    type: 'mining',
    center: offsetPos(center, 80, 0),
    radius: 8,
    assignedBots: [],
    structures: [
      makeStructure('Mine Entrance', 'house', offsetPos(center, 80, 0)),
    ],
    status: 'planned',
    priority: ZONE_PRIORITY.mining,
  };
}

function marketZone(center: { x: number; y: number; z: number }): Zone {
  return {
    id: uid('zone'),
    type: 'market',
    center: offsetPos(center, 0, 20),
    radius: 10,
    assignedBots: [],
    structures: [
      makeStructure('Market Stall', 'chest_room', offsetPos(center, 0, 20)),
    ],
    status: 'planned',
    priority: ZONE_PRIORITY.market,
  };
}

function parkZone(center: { x: number; y: number; z: number }): Zone {
  return {
    id: uid('zone'),
    type: 'park',
    center: offsetPos(center, -30, 30),
    radius: 10,
    assignedBots: [],
    structures: [],
    status: 'planned',
    priority: ZONE_PRIORITY.park,
  };
}

/* ================================================================
   SettlementPlanner
   ================================================================ */

export class SettlementPlanner {
  private plans: Map<string, SettlementPlan> = new Map();

  /* -------------------------------------------------------------- */
  /*  planSettlement                                                  */
  /* -------------------------------------------------------------- */

  planSettlement(
    center: { x: number; y: number; z: number },
    botCount: number,
    _terrain?: string,
  ): SettlementPlan {
    const zones: Zone[] = [];

    // Always: town center
    zones.push(townCenterZone(center));

    if (botCount <= 3) {
      // Minimal: center + 1 house + 1 farm + 1 storage
      zones.push(storageZone(center));
      zones.push(residentialZone(center, Math.min(botCount, 1)));
      zones.push(farmingZone(center, 1));
    } else if (botCount <= 6) {
      // Standard: full layout minus walls
      zones.push(storageZone(center));
      zones.push(workshopZone(center));
      zones.push(residentialZone(center, botCount));
      zones.push(farmingZone(center, 2));
      zones.push(guardTowerZone(center, false));
      zones.push(miningZone(center));
    } else if (botCount <= 10) {
      // Full layout with walls and multiple farms
      zones.push(storageZone(center));
      zones.push(workshopZone(center));
      zones.push(residentialZone(center, botCount));
      zones.push(farmingZone(center, Math.ceil(botCount / 2)));
      zones.push(guardTowerZone(center, true));
      zones.push(miningZone(center));
    } else {
      // Expanded: add market and park
      zones.push(storageZone(center));
      zones.push(workshopZone(center));
      zones.push(residentialZone(center, botCount));
      zones.push(farmingZone(center, Math.ceil(botCount / 2)));
      zones.push(guardTowerZone(center, true));
      zones.push(miningZone(center));
      zones.push(marketZone(center));
      zones.push(parkZone(center));
    }

    const buildOrder = this.getBuildOrder({ zones } as SettlementPlan);

    const plan: SettlementPlan = {
      id: uid('plan'),
      name: `Settlement at (${center.x}, ${center.z})`,
      center,
      zones,
      buildOrder,
      status: 'planning',
      createdAt: Date.now(),
    };

    this.plans.set(plan.id, plan);

    logger.info(
      { planId: plan.id, zoneCount: zones.length, botCount },
      'Settlement plan generated',
    );

    return plan;
  }

  /* -------------------------------------------------------------- */
  /*  estimateMaterials                                               */
  /* -------------------------------------------------------------- */

  estimateMaterials(plan: SettlementPlan): Record<string, number> {
    const totals: Record<string, number> = {};

    for (const zone of plan.zones) {
      for (const struct of zone.structures) {
        for (const [mat, qty] of Object.entries(struct.materials)) {
          totals[mat] = (totals[mat] ?? 0) + qty;
        }
      }
    }

    return totals;
  }

  /* -------------------------------------------------------------- */
  /*  getBuildOrder                                                    */
  /* -------------------------------------------------------------- */

  getBuildOrder(plan: SettlementPlan): string[] {
    return [...plan.zones]
      .sort((a, b) => a.priority - b.priority)
      .map((z) => z.id);
  }

  /* -------------------------------------------------------------- */
  /*  assignBotToZone                                                 */
  /* -------------------------------------------------------------- */

  assignBotToZone(
    plan: SettlementPlan,
    botName: string,
    personality: string,
  ): Zone | null {
    const preferredType = PERSONALITY_ZONE[personality] ?? null;

    if (preferredType === null) {
      logger.info({ botName, personality }, 'Bot personality is roaming — no zone assigned');
      return null;
    }

    // Find first zone of matching type
    let target = plan.zones.find(
      (z) => z.type === preferredType && !z.assignedBots.includes(botName),
    );

    // Fallback: pick any zone that could use help (fewest bots assigned)
    if (!target) {
      target = [...plan.zones]
        .filter((z) => !z.assignedBots.includes(botName))
        .sort((a, b) => a.assignedBots.length - b.assignedBots.length)[0];
    }

    if (!target) {
      logger.warn({ botName }, 'No available zone found for bot');
      return null;
    }

    target.assignedBots.push(botName);
    logger.info({ botName, zoneId: target.id, zoneType: target.type }, 'Bot assigned to zone');
    return target;
  }

  /* -------------------------------------------------------------- */
  /*  getNextStructureToBuild                                         */
  /* -------------------------------------------------------------- */

  getNextStructureToBuild(plan: SettlementPlan): Structure | null {
    const orderedZoneIds = plan.buildOrder.length
      ? plan.buildOrder
      : this.getBuildOrder(plan);

    for (const zoneId of orderedZoneIds) {
      const zone = plan.zones.find((z) => z.id === zoneId);
      if (!zone) continue;

      const unbuilt = zone.structures.find(
        (s) => s.status === 'planned' || s.status === 'gathering',
      );
      if (unbuilt) return unbuilt;
    }

    return null;
  }

  /* -------------------------------------------------------------- */
  /*  markStructureComplete                                           */
  /* -------------------------------------------------------------- */

  markStructureComplete(planId: string, structureId: string): boolean {
    const plan = this.plans.get(planId);
    if (!plan) {
      logger.warn({ planId }, 'Plan not found');
      return false;
    }

    for (const zone of plan.zones) {
      const struct = zone.structures.find((s) => s.id === structureId);
      if (struct) {
        struct.status = 'completed';
        logger.info({ planId, structureId, name: struct.name }, 'Structure marked complete');

        // Check if entire zone is now complete
        if (zone.structures.every((s) => s.status === 'completed')) {
          zone.status = 'completed';
          logger.info({ zoneId: zone.id, zoneType: zone.type }, 'Zone completed');
        } else if (zone.status === 'planned') {
          zone.status = 'in_progress';
        }

        // Check if entire plan is complete
        if (plan.zones.every((z) => z.status === 'completed')) {
          plan.status = 'completed';
          logger.info({ planId }, 'Settlement plan completed');
        } else if (plan.status === 'planning') {
          plan.status = 'active';
        }

        return true;
      }
    }

    logger.warn({ planId, structureId }, 'Structure not found in plan');
    return false;
  }

  /* -------------------------------------------------------------- */
  /*  getProgress                                                     */
  /* -------------------------------------------------------------- */

  getProgress(plan: SettlementPlan): number {
    let total = 0;
    let completed = 0;

    for (const zone of plan.zones) {
      for (const struct of zone.structures) {
        total++;
        if (struct.status === 'completed') completed++;
      }
    }

    if (total === 0) return 100;
    return Math.round((completed / total) * 100);
  }

  /* -------------------------------------------------------------- */
  /*  getPlan (convenience)                                           */
  /* -------------------------------------------------------------- */

  getPlan(planId: string): SettlementPlan | undefined {
    return this.plans.get(planId);
  }
}
