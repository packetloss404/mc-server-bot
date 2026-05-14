async function obtainOakPlanks(bot) {
  const targetPlanksCount = 4; // Target a reasonable number of planks
  let currentPlanks = bot.inventory.items().find(i => i.name === 'oak_planks')?.count || 0;
  while (currentPlanks < targetPlanksCount) {
    let oakLogs = bot.inventory.items().find(i => i.name === 'oak_log');

    // If we don't have enough logs, mine some
    if (!oakLogs || oakLogs.count === 0) {
      await mineBlock('oak_log', 1); // Mine at least one log
      oakLogs = bot.inventory.items().find(i => i.name === 'oak_log');
      if (!oakLogs || oakLogs.count === 0) {
        // If still no logs after mining, something went wrong, cannot proceed
        return;
      }
    }

    // Craft planks from available logs
    const planksToCraft = Math.min(oakLogs.count * 4, targetPlanksCount - currentPlanks);
    if (planksToCraft > 0) {
      await craftItem('oak_planks', planksToCraft);
    }

    // Update current planks count
    currentPlanks = bot.inventory.items().find(i => i.name === 'oak_planks')?.count || 0;
  }
}