async function mineOneOakLog(bot) {
  const logName = 'oak_log';
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
  await mineBlock(logName, 1);
}