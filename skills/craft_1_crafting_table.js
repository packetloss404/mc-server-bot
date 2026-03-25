async function craftOneCraftingTable(bot) {
  const craftingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (craftingTable) {
    return;
  }
  let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  if (!planks || planks.count < 4) {
    let logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    if (!logs) {
      await mineBlock('oak_log', 1);
      logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    }
    const plankType = logs.name.replace('_log', '_planks');
    await craftItem(plankType, 1);
  }
  await craftItem('crafting_table', 1);
}