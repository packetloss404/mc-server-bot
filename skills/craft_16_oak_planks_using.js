async function craft16OakPlanks(bot) {
  const targetPlanksCount = 16;
  const plankName = 'oak_planks';
  const logName = 'oak_log';
  const neededLogs = 4; // 1 log = 4 planks, so 4 logs = 16 planks

  // Check if we already have enough planks
  const currentPlanks = bot.inventory.items().find(item => item.name === plankName);
  if (currentPlanks && currentPlanks.count >= targetPlanksCount) {
    return;
  }

  // Check for oak logs
  const oakLogs = bot.inventory.items().find(item => item.name === logName);
  const currentLogCount = oakLogs ? oakLogs.count : 0;
  if (currentLogCount < neededLogs) {
    const logsToMine = neededLogs - currentLogCount;
    await mineBlock(logName, logsToMine);
  }

  // Craft the planks
  await craftItem(plankName, targetPlanksCount);
}