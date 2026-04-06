async function mineBirchLog(bot) {
  const target = 'birch_log';
  const birchLog = bot.findBlock({
    matching: b => b.name === target,
    maxDistance: 32
  });
  if (!birchLog) {
    await exploreUntil({
      x: 0,
      y: 0,
      z: 1
    }, 60, () => {
      return bot.findBlock({
        matching: b => b.name === target,
        maxDistance: 32
      });
    });
  }
  await mineBlock(target, 1);
}