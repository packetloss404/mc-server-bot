async function placeOneCraftingTable(bot) {
  // Check if crafting table already exists in inventory
  const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (tableItem && tableItem.count >= 1) {
    // Already have one, just place it
    const pos = bot.entity.position.offset(1, 0, 0);
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    return;
  }

  // Need to craft a crafting table
  // First ensure we have 4 planks
  const planksItem = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  let planksCount = planksItem ? planksItem.count : 0;
  if (planksCount < 4) {
    // Need to get logs and convert to planks
    const logItem = bot.inventory.items().find(i => i.name.endsWith('_log'));
    if (!logItem) {
      await mineBlock('oak_log', 1);
    }
    const logName = bot.inventory.items().find(i => i.name.endsWith('_log')).name;
    const plankName = logName.replace('_log', '_planks');
    await craftItem(plankName, 4);
  }

  // Now craft the crafting table using the 2x2 recipe
  await craftItem('crafting_table', 1);

  // Place the crafting table
  const pos = bot.entity.position.offset(1, 0, 0);
  await placeItem('crafting_table', pos.x, pos.y, pos.z);
}