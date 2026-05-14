async function craft4OakPlanks(bot) {
  // Check how many oak planks are already in inventory
  let oakPlanksCount = bot.inventory.items().find(item => item.name === 'oak_planks')?.count || 0;

  // Calculate how many more oak planks are needed
  const neededPlanks = 4 - oakPlanksCount;
  if (neededPlanks <= 0) {
    return; // Already have 4 or more oak planks
  }

  // Calculate how many oak logs are needed (1 log = 4 planks)
  const logsNeeded = Math.ceil(neededPlanks / 4);

  // Check current oak logs in inventory
  let oakLogsCount = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;

  // If not enough logs, mine them
  if (oakLogsCount < logsNeeded) {
    const logsToMine = logsNeeded - oakLogsCount;
    await mineBlock('oak_log', logsToMine);
    // Update logs count after mining
    oakLogsCount = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
  }

  // Craft the remaining needed planks
  if (oakLogsCount > 0) {
    // Craft in batches of 4 planks (using 1 log per 4 planks)
    const actualPlanksToCraft = Math.min(neededPlanks, oakLogsCount * 4);
    const logsToUse = Math.ceil(actualPlanksToCraft / 4);
    await craftItem('oak_planks', actualPlanksToCraft);
  }
}