async function craftCraftingTable(bot) {
  let craftingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (craftingTable) return;
  let planks = bot.inventory.items().find(i => i.name === 'oak_planks');
  let planksCount = planks ? planks.count : 0;
  if (planksCount < 4) {
    let logs = bot.inventory.items().find(i => i.name === 'oak_log');
    let logCount = logs ? logs.count : 0;
    let neededLogs = Math.ceil((4 - planksCount) / 4);
    if (logCount < neededLogs) {
      let targetLog = bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      });
      if (!targetLog) {
        await exploreUntil(0, 60, () => bot.findBlock({
          matching: b => b.name === 'oak_log',
          maxDistance: 32
        }));
      }
      await mineBlock('oak_log', neededLogs - logCount);
    }
    await craftItem('oak_planks', neededLogs);
  }
  await craftItem('crafting_table', 1);
}