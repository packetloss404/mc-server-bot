async function craftFortyOakPlanks(bot) {
  const plankName = 'oak_planks';
  const logName = 'oak_log';
  const targetCount = 40;
  const tableX = 974;
  const tableY = 75;
  const tableZ = 375;
  const currentPlanks = bot.inventory.items().find(i => i.name === plankName);
  const currentPlankCount = currentPlanks ? currentPlanks.count : 0;
  if (currentPlankCount < targetCount) {
    const neededPlanks = targetCount - currentPlankCount;
    const neededLogs = Math.ceil(neededPlanks / 4);
    const currentLogs = bot.inventory.items().find(i => i.name === logName);
    const currentLogCount = currentLogs ? currentLogs.count : 0;
    if (currentLogCount < neededLogs) {
      await mineBlock(logName, neededLogs - currentLogCount);
    }
    await moveTo(tableX, tableY, tableZ, 3);
    await craftItem(plankName, targetCount);
  }
}