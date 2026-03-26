async function mine3OakLogs(bot) {
  const logName = 'oak_log';
  const targetCount = 3;
  const currentLogs = bot.inventory.items().filter(i => i.name === logName).reduce((acc, i) => acc + i.count, 0);
  const needed = targetCount - currentLogs;
  if (needed <= 0) return;
  const oakLog = bot.findBlock({
    matching: b => b.name === logName,
    maxDistance: 32
  });
  if (!oakLog) {
    await exploreUntil('north', 60, () => bot.findBlock({
      matching: b => b.name === logName,
      maxDistance: 32
    }));
  }
  await mineBlock(logName, needed);
}