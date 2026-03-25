async function mineTwoOakLogs(bot) {
  const logName = 'oak_log';
  const targetCount = 2;
  const currentLogs = bot.inventory.items().filter(i => i.name === logName).reduce((acc, i) => acc + i.count, 0);
  const needed = targetCount - currentLogs;
  if (needed <= 0) return;
  const block = bot.findBlock({
    matching: b => b.name === logName,
    maxDistance: 32
  });
  if (!block) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === logName,
        maxDistance: 32
      });
    });
  }
  await mineBlock(logName, needed);
}