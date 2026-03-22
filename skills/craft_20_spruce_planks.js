async function craftSprucePlanks(bot) {
  let planks = bot.inventory.items().find(i => i.name === 'spruce_planks');
  let currentPlanks = planks ? planks.count : 0;
  if (currentPlanks >= 20) return;
  const neededPlanks = 20 - currentPlanks;
  const neededLogs = Math.ceil(neededPlanks / 4);
  let logs = bot.inventory.items().find(i => i.name === 'spruce_log');
  let currentLogs = logs ? logs.count : 0;
  if (currentLogs < neededLogs) {
    const logsToMine = neededLogs - currentLogs;
    await mineBlock('spruce_log', logsToMine);
  }
  await craftItem('spruce_planks', neededPlanks);
}