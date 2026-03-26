async function placeChestAtCraftingTable(bot) {
  // First, ensure we have a crafting table in inventory
  let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!tableItem) {
    // Craft a crafting table
    const planksItem = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    let planksCount = planksItem ? planksItem.count : 0;
    if (planksCount < 4) {
      const logItem = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!logItem) {
        await mineBlock('oak_log', 1);
      }
      const logName = bot.inventory.items().find(i => i.name.endsWith('_log')).name;
      const plankName = logName.replace('_log', '_planks');
      await craftItem(plankName, 4 - planksCount);
    }
    await craftItem('crafting_table', 1);
  }

  // Now ensure we have a chest in inventory
  let chestItem = bot.inventory.items().find(i => i.name === 'chest');
  if (!chestItem) {
    // Need to craft a chest - requires 8 planks
    const planksItem = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    let planksCount = planksItem ? planksItem.count : 0;
    if (planksCount < 8) {
      const logItem = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!logItem) {
        await mineBlock('oak_log', 1);
      }
      const logName = bot.inventory.items().find(i => i.name.endsWith('_log')).name;
      const plankName = logName.replace('_log', '_planks');
      await craftItem(plankName, 8 - planksCount);
    }
    // Craft the chest
    await craftItem('chest', 1);
  }

  // Place the chest at the target position
  await placeItem('chest', 857, 65, 254);
}