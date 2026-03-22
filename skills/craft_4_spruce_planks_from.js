async function craftFourSprucePlanksFromLog(bot) {
  const logName = 'spruce_log';
  const plankName = 'spruce_planks';

  // 1. Check for spruce_log in inventory
  let spruceLog = bot.inventory.items().find(i => i.name === logName);
  if (!spruceLog || spruceLog.count < 1) {
    // If not found, find and mine at least 1 spruce log
    const logBlock = bot.findBlock({
      matching: b => b.name === logName,
      maxDistance: 32
    });
    if (!logBlock) {
      await exploreUntil('north', 60, () => bot.findBlock({
        matching: b => b.name === logName,
        maxDistance: 32
      }));
    }
    await mineBlock(logName, 1);
    spruceLog = bot.inventory.items().find(i => i.name === logName);
  }
  if (!spruceLog || spruceLog.count < 1) {
    throw new Error(`Failed to obtain ${logName} for crafting.`);
  }

  // 2. Record initial plank count to verify later
  const initialPlanks = bot.inventory.items().find(i => i.name === plankName)?.count || 0;

  // 3. Craft 4 spruce planks.
  // In Minecraft, 1 log = 4 planks. We call craftItem for the resulting item.
  await craftItem(plankName, 4);

  // 4. Verify crafted item
  const finalPlanks = bot.inventory.items().find(i => i.name === plankName)?.count || 0;
  if (finalPlanks < initialPlanks + 4) {
    throw new Error(`Crafting failed: expected at least ${initialPlanks + 4} ${plankName}, but found ${finalPlanks}.`);
  }
}