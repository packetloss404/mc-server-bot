async function craftOneCraftingTable(bot) {
  const existingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (existingTable) {
    return;
  }
  const oakPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
  const oakPlankCount = oakPlanks ? oakPlanks.count : 0;
  if (oakPlankCount < 4) {
    let oakLog = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!oakLog) {
      await mineBlock('oak_log', 1);
      oakLog = bot.inventory.items().find(i => i.name === 'oak_log');
    }
    if (oakLog) {
      await craftItem('oak_planks', 1);
    } else {
      throw new Error('Could not find oak_planks or oak_log to craft a crafting table.');
    }
  }
  await craftItem('crafting_table', 1);
  const finalTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!finalTable) {
    throw new Error('Failed to craft crafting_table.');
  }
}