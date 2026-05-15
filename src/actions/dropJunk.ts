import { Bot } from 'mineflayer';
import { ActionResult } from './types';

// Ordered list of "junk" item names (most-junky first). Adjust to your taste —
// keep this conservative; we should never accidentally drop pickaxes or food.
const JUNK_PRIORITY: string[] = [
  'rotten_flesh', 'poisonous_potato', 'cobblestone', 'dirt', 'gravel', 'sand',
  'oak_sapling', 'spruce_sapling', 'birch_sapling', 'seeds', 'wheat_seeds',
  'andesite', 'diorite', 'granite', 'tuff', 'cobbled_deepslate',
];

const TOTAL_INVENTORY_SLOTS = 36;

/**
 * If the inventory has >= thresholdUsedSlots slots used (default 30 of 36),
 * drop stacks of the lowest-value junk until at least minFreeSlots are free.
 * Never drops tools, weapons, armor, food (>0 foodRecovery), or anything not
 * in the junk priority list.
 */
export async function dropJunk(
  bot: Bot,
  minFreeSlots = 6,
  thresholdUsedSlots = 30,
): Promise<ActionResult> {
  const usedSlots = bot.inventory.items().length;

  if (usedSlots < thresholdUsedSlots) {
    return {
      success: true,
      message: 'inventory ok, no drop needed',
      data: { dropped: 0 },
    };
  }

  let droppedTotal = 0;
  const droppedByName: Record<string, number> = {};

  for (const junkName of JUNK_PRIORITY) {
    // Re-evaluate free slots before each junk type so we stop as soon as
    // we have enough headroom.
    let freeSlots = TOTAL_INVENTORY_SLOTS - bot.inventory.items().length;
    if (freeSlots >= minFreeSlots) break;

    // Snapshot matching items; bot.toss may mutate the inventory state mid-loop.
    const matching = bot.inventory.items().filter((i) => i.name === junkName);
    for (const item of matching) {
      freeSlots = TOTAL_INVENTORY_SLOTS - bot.inventory.items().length;
      if (freeSlots >= minFreeSlots) break;

      const count = item.count;
      try {
        await bot.toss(item.type, null, count);
        droppedTotal += count;
        droppedByName[junkName] = (droppedByName[junkName] || 0) + count;
      } catch (err: any) {
        // Continue on toss errors — partial drops are still useful.
        return {
          success: false,
          message: `dropJunk failed while tossing ${junkName}: ${err?.message || String(err)}`,
          data: { dropped: droppedTotal, droppedByName },
        };
      }
    }
  }

  const finalFreeSlots = TOTAL_INVENTORY_SLOTS - bot.inventory.items().length;
  return {
    success: true,
    message: droppedTotal > 0
      ? `dropped ${droppedTotal} junk item(s); ${finalFreeSlots} slot(s) free`
      : 'no junk available to drop',
    data: { dropped: droppedTotal, droppedByName, freeSlots: finalFreeSlots },
  };
}
