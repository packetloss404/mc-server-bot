async function craft12OakPlanks(bot) {
  const plankName = 'oak_planks';
  const logName = 'oak_log';
  const targetCount = 12;
  const currentPlanks = bot.inventory.items().find(i => i.name === plankName);
  const currentPlankCount = currentPlanks ? currentPlanks.count : 0;
  if (currentPlankCount >= targetCount) {
    return;
  }
  const neededPlanks = targetCount - currentPlankCount;
  const neededLogs = Math.ceil(neededPlanks / 4);
  const currentLogs = bot.inventory.items().find(i => i.name === logName);
  const currentLogCount = currentLogs ? currentLogs.count : 0;
  if (currentLogCount < neededLogs) {
    await mineBlock(bot, logName, neededLogs - currentLogCount);
  }
  await craftItem(plankName, targetCount);
}