async function mineTenAndesiteBlocks(bot) {
  const andesite = bot.findBlock({
    matching: b => b.name === 'andesite',
    maxDistance: 32
  });
  if (!andesite) {
    await exploreUntil(bot.entity.forward, 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'andesite',
        maxDistance: 32
      });
    });
  }
  await mineBlock('andesite', 10);
}