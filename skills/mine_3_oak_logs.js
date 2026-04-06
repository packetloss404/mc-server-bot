async function mine3OakLogs(bot) {
  const logName = 'oak_log';
  const currentLogs = bot.inventory.items().filter(i => i.name === logName).reduce((acc, i) => acc + i.count, 0);
  const needed = 3 - currentLogs;
  if (needed <= 0) return;
  const block = bot.findBlock({
    matching: b => b.name === logName,
    maxDistance: 32
  });
  if (!block) {
    await exploreUntil({
      x: 0,
      y: 0,
      z: -1
    }, 60, () => {
      return bot.findBlock({
        matching: b => b.name === logName,
        maxDistance: 32
      });
    });
  }
  await mineBlock(logName, needed);
}