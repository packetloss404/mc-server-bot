import { logger } from '../util/logger';

/* ------------------------------------------------------------------ */
/*  Interfaces                                                         */
/* ------------------------------------------------------------------ */

export interface ResourceValue {
  name: string;
  supply: number;
  demand: number;
  value: number;
  trend: 'rising' | 'stable' | 'falling';
  lastUpdated: number;
}

export interface BotInventorySnapshot {
  botName: string;
  items: Record<string, number>;
  updatedAt: number;
}

export interface TradeOffer {
  id: string;
  fromBot: string;
  toBot?: string;
  offering: { item: string; count: number }[];
  requesting: { item: string; count: number }[];
  status: 'open' | 'accepted' | 'declined' | 'expired';
  createdAt: number;
  expiresAt: number;
}

/* ------------------------------------------------------------------ */
/*  Base value tiers                                                   */
/* ------------------------------------------------------------------ */

const BASE_VALUES: Record<string, number> = {
  // Ores & raw materials
  diamond: 100,
  emerald: 80,
  gold_ingot: 50,
  raw_gold: 45,
  gold_ore: 45,
  iron_ingot: 25,
  raw_iron: 22,
  iron_ore: 22,
  copper_ingot: 10,
  raw_copper: 8,
  coal: 5,
  lapis_lazuli: 15,
  redstone: 10,
  quartz: 12,
  amethyst_shard: 12,

  // Stone tier
  stone: 5,
  cobblestone: 1,
  deepslate: 2,
  cobbled_deepslate: 1,
  dirt: 1,
  gravel: 1,
  sand: 2,
  clay_ball: 3,
  netherrack: 1,

  // Wood tier
  oak_log: 2,
  spruce_log: 2,
  birch_log: 2,
  jungle_log: 2,
  acacia_log: 2,
  dark_oak_log: 2,
  mangrove_log: 2,
  cherry_log: 2,
  oak_planks: 1,
  spruce_planks: 1,
  birch_planks: 1,
  jungle_planks: 1,
  acacia_planks: 1,
  dark_oak_planks: 1,
  stick: 1,

  // Tools - diamond
  diamond_pickaxe: 350,
  diamond_sword: 250,
  diamond_axe: 350,
  diamond_shovel: 150,
  diamond_hoe: 250,
  // Tools - iron
  iron_pickaxe: 80,
  iron_sword: 55,
  iron_axe: 80,
  iron_shovel: 30,
  iron_hoe: 55,
  // Tools - stone
  stone_pickaxe: 18,
  stone_sword: 13,
  stone_axe: 18,
  stone_shovel: 8,
  // Tools - wood
  wooden_pickaxe: 8,
  wooden_sword: 6,
  wooden_axe: 8,
  wooden_shovel: 4,
  // Tools - gold
  golden_pickaxe: 160,
  golden_sword: 110,
  golden_axe: 160,
  golden_shovel: 60,

  // Armor - diamond
  diamond_helmet: 550,
  diamond_chestplate: 900,
  diamond_leggings: 750,
  diamond_boots: 450,
  // Armor - iron
  iron_helmet: 140,
  iron_chestplate: 225,
  iron_leggings: 185,
  iron_boots: 110,

  // Food
  cooked_beef: 15,
  cooked_porkchop: 15,
  cooked_chicken: 12,
  cooked_mutton: 12,
  cooked_salmon: 12,
  cooked_cod: 10,
  bread: 10,
  golden_apple: 120,
  beef: 8,
  porkchop: 8,
  chicken: 6,
  mutton: 6,
  salmon: 6,
  cod: 5,
  wheat: 5,
  carrot: 5,
  potato: 5,
  beetroot: 4,
  melon_slice: 3,
  sweet_berries: 3,
  apple: 6,

  // Misc useful
  string: 3,
  leather: 8,
  feather: 2,
  bone: 3,
  gunpowder: 8,
  ender_pearl: 30,
  blaze_rod: 35,
  ghast_tear: 40,
  slime_ball: 6,
  obsidian: 20,
  flint: 2,
  bucket: 30,
  glass: 3,
  torch: 2,
  crafting_table: 3,
  furnace: 10,
  chest: 10,
  bookshelf: 18,
  book: 10,
  paper: 3,
};

/* ------------------------------------------------------------------ */
/*  Common crafting recipe demand map                                  */
/*  "craft X" -> what materials are needed                             */
/* ------------------------------------------------------------------ */

const RECIPE_DEMANDS: Record<string, Record<string, number>> = {
  // Pickaxes
  wooden_pickaxe: { oak_planks: 3, stick: 2 },
  stone_pickaxe: { cobblestone: 3, stick: 2 },
  iron_pickaxe: { iron_ingot: 3, stick: 2 },
  golden_pickaxe: { gold_ingot: 3, stick: 2 },
  diamond_pickaxe: { diamond: 3, stick: 2 },
  // Swords
  wooden_sword: { oak_planks: 2, stick: 1 },
  stone_sword: { cobblestone: 2, stick: 1 },
  iron_sword: { iron_ingot: 2, stick: 1 },
  golden_sword: { gold_ingot: 2, stick: 1 },
  diamond_sword: { diamond: 2, stick: 1 },
  // Axes
  wooden_axe: { oak_planks: 3, stick: 2 },
  stone_axe: { cobblestone: 3, stick: 2 },
  iron_axe: { iron_ingot: 3, stick: 2 },
  golden_axe: { gold_ingot: 3, stick: 2 },
  diamond_axe: { diamond: 3, stick: 2 },
  // Shovels
  wooden_shovel: { oak_planks: 1, stick: 2 },
  stone_shovel: { cobblestone: 1, stick: 2 },
  iron_shovel: { iron_ingot: 1, stick: 2 },
  golden_shovel: { gold_ingot: 1, stick: 2 },
  diamond_shovel: { diamond: 1, stick: 2 },
  // Armor
  iron_helmet: { iron_ingot: 5 },
  iron_chestplate: { iron_ingot: 8 },
  iron_leggings: { iron_ingot: 7 },
  iron_boots: { iron_ingot: 4 },
  diamond_helmet: { diamond: 5 },
  diamond_chestplate: { diamond: 8 },
  diamond_leggings: { diamond: 7 },
  diamond_boots: { diamond: 4 },
  // Common items
  crafting_table: { oak_planks: 4 },
  chest: { oak_planks: 8 },
  furnace: { cobblestone: 8 },
  stick: { oak_planks: 2 },
  torch: { stick: 1, coal: 1 },
  bread: { wheat: 3 },
  bucket: { iron_ingot: 3 },
  oak_planks: { oak_log: 1 },
  spruce_planks: { spruce_log: 1 },
  birch_planks: { birch_log: 1 },
  bookshelf: { oak_planks: 6, book: 3 },
  book: { paper: 3, leather: 1 },
  paper: { sugar_cane: 3 },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TRADE_OFFER_TTL_MS = 5 * 60 * 1000; // 5 minutes
const VALUE_HISTORY_SIZE = 10;

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ------------------------------------------------------------------ */
/*  ResourceValuation                                                  */
/* ------------------------------------------------------------------ */

export class ResourceValuation {
  private inventories: Map<string, BotInventorySnapshot> = new Map();
  private demandMap: Record<string, number> = {};
  private valueHistory: Map<string, number[]> = new Map();
  private cachedValues: Map<string, ResourceValue> = new Map();
  private offers: TradeOffer[] = [];

  constructor() {
    logger.info('ResourceValuation initialised');
  }

  /* ---------- Inventory / supply tracking ---------- */

  updateInventory(botName: string, inventory: Record<string, number>): void {
    this.inventories.set(botName, {
      botName,
      items: { ...inventory },
      updatedAt: Date.now(),
    });
    this.recalculate();
  }

  /* ---------- Demand tracking ---------- */

  updateDemand(pendingTasks: Array<{ description: string; keywords: string[] }>): void {
    const newDemand: Record<string, number> = {};

    for (const task of pendingTasks) {
      const desc = task.description.toLowerCase();

      // Try to match "craft <item>" pattern first
      const craftMatch = desc.match(/craft\s+(?:a\s+|an\s+)?(\d*)\s*(\w+)/);
      if (craftMatch) {
        const count = parseInt(craftMatch[1]) || 1;
        const item = craftMatch[2];
        const recipe = RECIPE_DEMANDS[item];
        if (recipe) {
          for (const [mat, qty] of Object.entries(recipe)) {
            newDemand[mat] = (newDemand[mat] || 0) + qty * count;
          }
        } else {
          // Unknown recipe - just register demand for the item itself
          newDemand[item] = (newDemand[item] || 0) + count;
        }
        continue;
      }

      // Try to match "mine/collect/gather N <item>" pattern
      const mineMatch = desc.match(/(?:mine|collect|gather|get|obtain|find|harvest)\s+(\d+)\s+(\w+)/);
      if (mineMatch) {
        const count = parseInt(mineMatch[1]) || 1;
        const item = mineMatch[2];
        newDemand[item] = (newDemand[item] || 0) + count;
        continue;
      }

      // Fall back to keyword-based demand estimation
      for (const kw of task.keywords) {
        const key = kw.toLowerCase();
        if (BASE_VALUES[key] || RECIPE_DEMANDS[key]) {
          newDemand[key] = (newDemand[key] || 0) + 1;
        }
      }
    }

    this.demandMap = newDemand;
    this.recalculate();
  }

  /* ---------- Value queries ---------- */

  getValue(itemName: string): ResourceValue {
    const cached = this.cachedValues.get(itemName);
    if (cached) return cached;

    // Return a default entry for unknown items
    const base = BASE_VALUES[itemName] ?? 1;
    return {
      name: itemName,
      supply: 0,
      demand: 0,
      value: base,
      trend: 'stable',
      lastUpdated: Date.now(),
    };
  }

  getAllValues(): ResourceValue[] {
    return [...this.cachedValues.values()].sort((a, b) => b.value - a.value);
  }

  getHighDemand(threshold = 2): ResourceValue[] {
    return this.getAllValues().filter((v) => v.demand > v.supply * threshold);
  }

  /* ---------- Per-bot surplus / deficit ---------- */

  getSurplus(botName: string): { item: string; excess: number }[] {
    const snap = this.inventories.get(botName);
    if (!snap) return [];

    const averages = this.computeAverages();
    const results: { item: string; excess: number }[] = [];

    for (const [item, count] of Object.entries(snap.items)) {
      const avg = averages[item] ?? 0;
      if (count > avg && count > 0) {
        results.push({ item, excess: Math.floor(count - avg) });
      }
    }

    return results.sort((a, b) => b.excess - a.excess);
  }

  getDeficit(botName: string): { item: string; deficit: number }[] {
    const snap = this.inventories.get(botName);
    const averages = this.computeAverages();
    const results: { item: string; deficit: number }[] = [];

    const botItems = snap ? snap.items : {};
    for (const [item, avg] of Object.entries(averages)) {
      const have = botItems[item] ?? 0;
      if (have < avg) {
        results.push({ item, deficit: Math.ceil(avg - have) });
      }
    }

    return results.sort((a, b) => b.deficit - a.deficit);
  }

  /* ---------- Trade evaluation ---------- */

  evaluateOffer(offer: TradeOffer, evaluatorBot: string): number {
    let offeredValue = 0;
    let requestedValue = 0;

    const surplus = new Map(this.getSurplus(evaluatorBot).map((s) => [s.item, s.excess]));
    const deficit = new Map(this.getDeficit(evaluatorBot).map((d) => [d.item, d.deficit]));

    for (const { item, count } of offer.offering) {
      const rv = this.getValue(item);
      let multiplier = 1;
      // Items the evaluator is receiving - worth more if evaluator has a deficit
      if (deficit.has(item)) multiplier = 1.3;
      offeredValue += rv.value * count * multiplier;
    }

    for (const { item, count } of offer.requesting) {
      const rv = this.getValue(item);
      let multiplier = 1;
      // Items the evaluator is giving up - worth more if evaluator has no surplus
      if (!surplus.has(item)) multiplier = 1.3;
      requestedValue += rv.value * count * multiplier;
    }

    if (offeredValue + requestedValue === 0) return 0;
    // Normalise to -1..1 range
    const raw = (offeredValue - requestedValue) / (offeredValue + requestedValue);
    return Math.max(-1, Math.min(1, raw));
  }

  suggestTrade(
    fromBot: string,
    toBot: string,
  ): { offering: { item: string; count: number }[]; requesting: { item: string; count: number }[] } | null {
    const fromSurplus = this.getSurplus(fromBot);
    const toSurplus = this.getSurplus(toBot);
    const fromDeficit = new Set(this.getDeficit(fromBot).map((d) => d.item));
    const toDeficit = new Set(this.getDeficit(toBot).map((d) => d.item));

    // What fromBot has that toBot needs
    const offering: { item: string; count: number }[] = [];
    for (const s of fromSurplus) {
      if (toDeficit.has(s.item) && s.excess > 0) {
        offering.push({ item: s.item, count: Math.min(s.excess, 16) });
      }
    }

    // What toBot has that fromBot needs
    const requesting: { item: string; count: number }[] = [];
    for (const s of toSurplus) {
      if (fromDeficit.has(s.item) && s.excess > 0) {
        requesting.push({ item: s.item, count: Math.min(s.excess, 16) });
      }
    }

    if (offering.length === 0 && requesting.length === 0) return null;

    // Balance trade value roughly
    const offerVal = offering.reduce((sum, o) => sum + this.getValue(o.item).value * o.count, 0);
    const reqVal = requesting.reduce((sum, r) => sum + this.getValue(r.item).value * r.count, 0);

    // If very imbalanced, trim the larger side
    if (offerVal > 0 && reqVal > 0) {
      const ratio = offerVal / reqVal;
      if (ratio > 2) {
        // Reduce offering counts
        for (const o of offering) {
          o.count = Math.max(1, Math.floor(o.count / ratio));
        }
      } else if (ratio < 0.5) {
        // Reduce requesting counts
        const inv = reqVal / offerVal;
        for (const r of requesting) {
          r.count = Math.max(1, Math.floor(r.count / inv));
        }
      }
    }

    return { offering, requesting };
  }

  createOffer(
    fromBot: string,
    offering: { item: string; count: number }[],
    requesting: { item: string; count: number }[],
    toBot?: string,
  ): TradeOffer {
    const now = Date.now();
    const offer: TradeOffer = {
      id: generateId('trade'),
      fromBot,
      toBot,
      offering,
      requesting,
      status: 'open',
      createdAt: now,
      expiresAt: now + TRADE_OFFER_TTL_MS,
    };
    this.offers.push(offer);
    this.expireOldOffers();
    logger.info({ fromBot, toBot, offering, requesting }, 'Trade offer created');
    return offer;
  }

  getOpenOffers(botName?: string): TradeOffer[] {
    this.expireOldOffers();
    return this.offers.filter(
      (o) => o.status === 'open' && (!botName || o.fromBot === botName || o.toBot === botName || !o.toBot),
    );
  }

  /* ---------- Internals ---------- */

  private recalculate(): void {
    const now = Date.now();
    const allItems = new Set<string>();

    // Gather all known item names
    for (const snap of this.inventories.values()) {
      for (const item of Object.keys(snap.items)) allItems.add(item);
    }
    for (const item of Object.keys(this.demandMap)) allItems.add(item);
    for (const item of Object.keys(BASE_VALUES)) allItems.add(item);

    for (const item of allItems) {
      const supply = this.computeSupply(item);
      const demand = this.demandMap[item] ?? 0;
      const baseValue = BASE_VALUES[item] ?? 1;

      // Value formula: base_value weighted by demand / supply ratio
      const demandWeight = Math.max(1, demand);
      const supplyFactor = supply + 1;
      const value = Math.round((baseValue * demandWeight) / supplyFactor * 100) / 100;

      // Update history and compute trend
      const history = this.valueHistory.get(item) ?? [];
      history.push(value);
      if (history.length > VALUE_HISTORY_SIZE) history.shift();
      this.valueHistory.set(item, history);

      const trend = this.computeTrend(history);

      this.cachedValues.set(item, { name: item, supply, demand, value, trend, lastUpdated: now });
    }
  }

  private computeSupply(item: string): number {
    let total = 0;
    for (const snap of this.inventories.values()) {
      total += snap.items[item] ?? 0;
    }
    return total;
  }

  private computeAverages(): Record<string, number> {
    const totals: Record<string, number> = {};
    const botCount = this.inventories.size || 1;

    for (const snap of this.inventories.values()) {
      for (const [item, count] of Object.entries(snap.items)) {
        totals[item] = (totals[item] || 0) + count;
      }
    }

    const avgs: Record<string, number> = {};
    for (const [item, total] of Object.entries(totals)) {
      avgs[item] = total / botCount;
    }
    return avgs;
  }

  private computeTrend(history: number[]): 'rising' | 'stable' | 'falling' {
    if (history.length < 3) return 'stable';

    const recent = history.slice(-3);
    const older = history.slice(-6, -3);
    if (older.length === 0) return 'stable';

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    const changeRatio = olderAvg === 0 ? (recentAvg > 0 ? 1 : 0) : (recentAvg - olderAvg) / olderAvg;

    if (changeRatio > 0.1) return 'rising';
    if (changeRatio < -0.1) return 'falling';
    return 'stable';
  }

  private expireOldOffers(): void {
    const now = Date.now();
    for (const offer of this.offers) {
      if (offer.status === 'open' && offer.expiresAt < now) {
        offer.status = 'expired';
      }
    }
    // Keep only recent offers (last 200)
    if (this.offers.length > 200) {
      this.offers = this.offers.slice(-200);
    }
  }
}
