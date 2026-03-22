async function craftTwelveSprucePlanksAtTable(bot) {
  const tablePos = {
    x: 807,
    y: 64,
    z: 232
  };

  // 1. Check if we already have enough spruce logs (3 logs = 12 planks)
  let spruceLogs = bot.inventory.items().find(i => i.name === 'spruce_log');
  let currentLogs = spruceLogs ? spruceLogs.count : 0;
  if (currentLogs < 3) {
    // If we don't have enough logs, mine them. 
    // mineBlock will handle finding and moving to the logs.
    await mineBlock('spruce_log', 3 - currentLogs);
  }

  // 2. Move to the specific crafting table location provided in the task
  await moveTo(tablePos.x, tablePos.y, tablePos.z, 3, 120);

  // 3. Verify if the crafting table exists at the target location
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });

  // 4. Craft 12 spruce planks
  // craftItem will automatically use a nearby crafting table if required.
  await craftItem('spruce_planks', 12);
}