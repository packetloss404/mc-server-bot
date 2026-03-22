async function craftFourOakPlanksFromLogTask(bot) {
  const logName = 'oak_log';
  const plankName = 'oak_planks';

  // 1. Check whether oak_log is already in inventory.
  let log = bot.inventory.items().find(i => i.name === logName);

  // 2. Collect the prerequisite materials if missing.
  if (!log || log.count < 1) {
    await mineBlock(logName, 1);
    log = bot.inventory.items().find(i => i.name === logName);
  }
  if (!log) {
    throw new Error("Could not find or collect oak_log.");
  }

  // Record initial plank count to verify success.
  const initialPlanks = bot.inventory.items().find(i => i.name === plankName)?.count || 0;

  // 3. Use craftItem(...) for hand crafting (oak planks don't require a table).
  // Note: craftItem(name, count) crafts the specified number of items.
  // 1 log = 4 planks.
  await craftItem(plankName, 4);

  // 5. Verify the crafted item appears in inventory before finishing.
  const finalPlanks = bot.inventory.items().find(i => i.name === plankName)?.count || 0;
  if (finalPlanks < initialPlanks + 4) {
    throw new Error(`Crafting failed: expected at least ${initialPlanks + 4} ${plankName}, but found ${finalPlanks}.`);
  }
}