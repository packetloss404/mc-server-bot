async function obtainOakPlanks(bot) {
  const targetPlanksCount = 4;
  let currentPlanks = bot.inventory.items().find(i => i.name === 'oak_planks')?.count || 0;
  while (currentPlanks < targetPlanksCount) {
    let oakLogs = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!oakLogs || oakLogs.count === 0) {
      await mineBlock('oak_log', 1);
      oakLogs = bot.inventory.items().find(i => i.name === 'oak_log');
      if (!oakLogs || oakLogs.count === 0) {
        return;
      }
    }
    const planksToCraft = Math.min(oakLogs.count * 4, targetPlanksCount - currentPlanks);
    if (planksToCraft > 0) {
      await craftItem('oak_planks', planksToCraft);
    }
    currentPlanks = bot.inventory.items().find(i => i.name === 'oak_planks')?.count || 0;
  }
}