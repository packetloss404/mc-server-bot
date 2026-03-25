async function mineThreeOakLogsAtLocation(bot) {
  const currentLogs = bot.inventory.items().filter(i => i.name === 'oak_log').reduce((acc, i) => acc + i.count, 0);
  const needed = 3 - currentLogs;
  if (needed <= 0) return;
  await moveTo(931, 68, 338, 3, 60);
  await mineBlock('oak_log', needed);
}