async function craftCraftingTable(bot) {
  const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (tableItem && tableItem.count >= 1) {
    return;
  }
  const planksItem = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  let planksCount = planksItem ? planksItem.count : 0;
  if (planksCount < 4) {
    const logItem = bot.inventory.items().find(i => i.name.endsWith('_log'));
    if (!logItem) {
      await mineBlock('oak_log', 1);
    }
    const logName = bot.inventory.items().find(i => i.name.endsWith('_log')).name;
    const plankName = logName.replace('_log', '_planks');
    await craftItem(plankName, 4);
  }
  await craftItem('crafting_table', 1);
  const finalTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!finalTable) {
    throw new Error('Crafting table was not found in inventory after crafting attempt.');
  }
}