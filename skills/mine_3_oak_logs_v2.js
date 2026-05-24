async function mine_3_oak_logs(bot) {
  const logName = 'oak_log';
  const targetCount = 3;
  const currentLogs = bot.inventory.items().filter(i => i.name === logName).reduce((acc, i) => acc + i.count, 0);
  const needed = targetCount - currentLogs;
  if (needed <= 0) return;
  let block = bot.findBlock({
    matching: b => b.name === logName,
    maxDistance: 32
  });
  if (!block) {
    await exploreUntil('north', 30, () => {
      return bot.findBlock({
        matching: b => b.name === logName,
        maxDistance: 32
      });
    });
    block = bot.findBlock({
      matching: b => b.name === logName,
      maxDistance: 32
    });
  }
  if (block) {
    await mineBlock(logName, needed);
  }
}