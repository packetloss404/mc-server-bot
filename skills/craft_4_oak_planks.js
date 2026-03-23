async function craftFourOakPlanks(bot) {
  const logs = bot.inventory.items().find(i => i.name === 'oak_log');
  if (!logs || logs.count < 1) {
    const targetLog = bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });
    if (!targetLog) {
      await exploreUntil(0, 60, () => bot.findBlock({
        matching: b => b.name === 'oak_log',
        maxDistance: 32
      }));
    }
    await mineBlock('oak_log', 1);
  }
  await craftItem('oak_planks', 1);
}