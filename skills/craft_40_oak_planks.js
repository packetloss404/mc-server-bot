async function craftFortyOakPlanks(bot) {
  let planks = bot.inventory.items().find(i => i.name === 'oak_planks');
  let planksCount = planks ? planks.count : 0;
  let neededPlanks = 40 - planksCount;
  if (neededPlanks <= 0) return;
  let neededCrafts = Math.ceil(neededPlanks / 4);
  let logs = bot.inventory.items().find(i => i.name === 'oak_log');
  let logCount = logs ? logs.count : 0;
  if (logCount < neededCrafts) {
    let targetLog = bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });
    if (!targetLog) {
      await exploreUntil(0, 60, () => bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      }));
    }
    await mineBlock('oak_log', neededCrafts - logCount);
  }
  await craftItem('oak_planks', neededCrafts);
}