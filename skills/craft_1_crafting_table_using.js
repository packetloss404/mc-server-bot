async function craftCraftingTableFromLogs(bot) {
  const planks = bot.inventory.items().find(i => i.name === 'oak_planks');
  const planksCount = planks ? planks.count : 0;
  if (planksCount < 4) {
    const logs = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!logs || logs.count < 1) {
      await mineBlock('oak_log', 1);
    }
    await craftItem('oak_planks', 1);
  }
  await craftItem('crafting_table', 1);
}