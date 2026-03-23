async function craftCraftingTableFromOakLog(bot) {
  const craftingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (craftingTable) return;
  let oakPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
  if (!oakPlanks || oakPlanks.count < 4) {
    let oakLog = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!oakLog) {
      await mineBlock('oak_log', 1);
    }
    await craftItem('oak_planks', 1);
  }
  await craftItem('crafting_table', 1);
}