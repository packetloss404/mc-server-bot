async function mineTenAndesite(bot) {
  const andesite = bot.findBlock({
    matching: b => b.name === 'andesite',
    maxDistance: 32
  });
  if (!andesite) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'andesite',
        maxDistance: 32
      });
    });
  }
  await mineBlock('andesite', 10);
}