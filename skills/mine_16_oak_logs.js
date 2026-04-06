async function mineSixteenOakLogs(bot) {
  const logName = 'oak_log';
  const targetTotal = 16;
  const getCount = () => bot.inventory.items().filter(item => item.name === logName).reduce((sum, item) => sum + item.count, 0);
  const currentCount = getCount();
  const needed = targetTotal - currentCount;
  if (needed <= 0) return;
  const findLog = () => bot.findBlock({
    matching: b => b.name === logName,
    maxDistance: 32
  });
  if (!findLog()) {
    await exploreUntil('north', 60, () => findLog());
  }
  await mineBlock(logName, needed);
}