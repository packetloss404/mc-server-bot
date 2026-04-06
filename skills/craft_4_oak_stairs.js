async function craft4OakStairs(bot) {
  const existingStairs = bot.inventory.items().find(i => i.name === 'oak_stairs');
  if (existingStairs && existingStairs.count >= 4) return;
  const planks = bot.inventory.items().find(i => i.name === 'oak_planks');
  const currentPlanks = planks ? planks.count : 0;
  if (currentPlanks < 6) {
    const logs = bot.inventory.items().find(i => i.name === 'oak_log');
    const currentLogs = logs ? logs.count : 0;
    const logsNeededForPlanks = Math.ceil((6 - currentPlanks) / 4);
    if (currentLogs < logsNeededForPlanks) {
      const logBlock = bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      });
      if (!logBlock) {
        await exploreUntil(new (require('vec3').Vec3)(1, 0, 0), 60, () => bot.findBlock({
          matching: b => b.name === 'oak_log',
          maxDistance: 32
        }));
      }
      await mineBlock('oak_log', logsNeededForPlanks - currentLogs);
    }
    await craftItem('oak_planks', logsNeededForPlanks);
  }
  await craftItem('oak_stairs', 1);
}