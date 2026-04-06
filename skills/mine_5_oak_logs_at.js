async function mineFiveOakLogs(bot) {
  const logName = 'oak_log';
  const targetCount = 5;
  const oakLog = bot.findBlock({
    matching: b => b.name === logName,
    maxDistance: 32
  });
  if (!oakLog) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === logName,
        maxDistance: 32
      });
    });
  }
  await mineBlock(logName, targetCount);
}