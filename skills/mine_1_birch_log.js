async function mineOneBirchLog(bot) {
  const targetBlock = 'birch_log';
  const count = 1;
  const birchLog = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!birchLog) {
    await exploreUntil({
      x: 0,
      y: 0,
      z: 1
    }, 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetBlock, count);
}