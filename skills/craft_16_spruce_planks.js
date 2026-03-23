async function craftSixteenSprucePlanks(bot) {
  let planks = bot.inventory.items().find(i => i.name === 'spruce_planks');
  let planksCount = planks ? planks.count : 0;
  if (planksCount >= 16) {
    return;
  }
  const neededPlanks = 16 - planksCount;
  const craftsNeeded = Math.ceil(neededPlanks / 4);
  let logs = bot.inventory.items().find(i => i.name === 'spruce_log');
  let logCount = logs ? logs.count : 0;
  if (logCount < craftsNeeded) {
    await mineBlock('spruce_log', craftsNeeded - logCount);
  }
  await craftItem('spruce_planks', craftsNeeded);
}