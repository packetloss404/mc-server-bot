async function craftCraftingTableAtLocation(bot) {
  const existingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!existingTable) {
    let planks = bot.inventory.items().find(i => i.name === 'oak_planks');
    let planksCount = planks ? planks.count : 0;
    if (planksCount < 4) {
      let logs = bot.inventory.items().find(i => i.name === 'oak_log');
      let logCount = logs ? logs.count : 0;
      let neededLogs = Math.ceil((4 - planksCount) / 4);
      if (logCount < neededLogs) {
        await mineBlock('oak_log', neededLogs - logCount);
      }
      await craftItem('oak_planks', neededLogs);
    }
    await craftItem('crafting_table', 1);
  }
  const tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    await placeItem('crafting_table', 936, 76, 214);
  }
}