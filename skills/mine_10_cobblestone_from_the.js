async function mineTenCobblestone(bot) {
  const targetBlock = 'stone';
  const count = 10;
  const stone = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!stone) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetBlock, count);
}