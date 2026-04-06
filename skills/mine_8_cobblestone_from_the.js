async function mineEightCobblestone(bot) {
  const targetBlock = 'stone';
  const count = 8;
  const stone = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!stone) {
    await exploreUntil(bot.entity.yaw, 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetBlock, count);
}