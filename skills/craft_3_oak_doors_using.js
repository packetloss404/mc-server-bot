async function craftThreeOakDoors(bot) {
  const plankName = 'oak_planks';
  const logName = 'oak_log';
  const doorName = 'oak_door';
  const targetPlanks = 6;
  const currentPlanks = bot.inventory.items().find(i => i.name === plankName);
  const currentPlankCount = currentPlanks ? currentPlanks.count : 0;
  if (currentPlankCount < targetPlanks) {
    const neededPlanks = targetPlanks - currentPlankCount;
    const neededLogs = Math.ceil(neededPlanks / 4);
    const currentLogs = bot.inventory.items().find(i => i.name === logName);
    const currentLogCount = currentLogs ? currentLogs.count : 0;
    if (currentLogCount < neededLogs) {
      await mineBlock(logName, neededLogs - currentLogCount);
    }
    await craftItem(plankName, targetPlanks);
  }
  await craftItem(doorName, 3);
}