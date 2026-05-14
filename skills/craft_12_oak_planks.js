async function craft12OakPlanks(bot) {
  const targetPlanks = 12;
  let oakPlanksCount = bot.inventory.items().find(item => item.name === 'oak_planks')?.count || 0;
  if (oakPlanksCount >= targetPlanks) {
    return; // Already have enough oak planks
  }
  const planksToCraft = targetPlanks - oakPlanksCount;
  // Each oak log yields 4 oak planks.
  const logsNeeded = Math.ceil(planksToCraft / 4);
  let oakLogsCount = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
  if (oakLogsCount < logsNeeded) {
    const logsToMine = logsNeeded - oakLogsCount;
    await mineBlock('oak_log', logsToMine);
  }

  // After potentially mining, update log count
  oakLogsCount = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
  if (oakLogsCount > 0) {
    // Craft all available logs into planks, up to the target
    const actualPlanksToCraft = Math.min(oakLogsCount * 4, planksToCraft);
    // craftItem takes the number of final items to craft, not the number of logs
    await craftItem('oak_planks', actualPlanksToCraft);
  }
}