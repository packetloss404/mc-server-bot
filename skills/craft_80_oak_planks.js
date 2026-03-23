async function craftEightyOakPlanks(bot) {
  const operationsNeeded = 20;
  let logs = bot.inventory.items().find(i => i.name === 'oak_log');
  let logCount = logs ? logs.count : 0;
  if (logCount < operationsNeeded) {
    await mineBlock('oak_log', operationsNeeded - logCount);
  }
  await craftItem('oak_planks', operationsNeeded);
}