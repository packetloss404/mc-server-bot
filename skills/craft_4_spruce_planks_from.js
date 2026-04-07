async function craftFourSprucePlanksAtTable(bot) {
  const spruceLog = bot.inventory.items().find(i => i.name === 'spruce_log');
  if (!spruceLog || spruceLog.count < 1) {
    await mineBlock('spruce_log', 1);
  }
  // Plank crafting works without a table, but if one is nearby we still position there
  const table = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 32 });
  if (table) {
    await moveTo(table.position.x, table.position.y, table.position.z, 3, 60);
  }
  await craftItem('spruce_planks', 4);
}
