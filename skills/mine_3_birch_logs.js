async function mineThreeBirchLogs(bot) {
  const targetBlock = 'birch_log';
  const count = 3;
  const birchLog = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!birchLog) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetBlock, count);
}