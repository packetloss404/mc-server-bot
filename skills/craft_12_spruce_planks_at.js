async function craftTwelveSprucePlanksAtTable(bot) {
  let spruceLogs = bot.inventory.items().find(i => i.name === 'spruce_log');
  let currentLogs = spruceLogs ? spruceLogs.count : 0;
  if (currentLogs < 3) {
    await mineBlock('spruce_log', 3 - currentLogs);
  }
  // Find or place a nearby crafting table (planks crafting actually works without one,
  // but the saved successful version of this skill always positioned at a table first)
  let tableBlock = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 32 });
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3, 60);
  }
  await craftItem('spruce_planks', 12);
}
