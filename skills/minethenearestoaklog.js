async function mine_the_nearest_oak_log(bot) {
  const logName = 'oak_log';
  const block = bot.findBlock({
    matching: b => b.name === logName,
    maxDistance: 32
  });
  if (!block) {
    await exploreUntil(bot.entity.yaw, 60, () => {
      return bot.findBlock({
        matching: b => b.name === logName,
        maxDistance: 32
      });
    });
  }
  await mineBlock(logName, 1);
}