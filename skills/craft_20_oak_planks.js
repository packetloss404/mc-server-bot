async function craftTwentyOakPlanks(bot) {
  const targetPlanks = 20;
  const planks = bot.inventory.items().find(i => i.name === 'oak_planks');
  const currentPlanks = planks ? planks.count : 0;
  if (currentPlanks >= targetPlanks) return;
  const neededPlanks = targetPlanks - currentPlanks;
  const recipesToCraft = Math.ceil(neededPlanks / 4);
  const logs = bot.inventory.items().find(i => i.name === 'oak_log');
  const currentLogs = logs ? logs.count : 0;
  if (currentLogs < recipesToCraft) {
    await mineBlock('oak_log', recipesToCraft - currentLogs);
  }
  await craftItem('oak_planks', recipesToCraft);
}