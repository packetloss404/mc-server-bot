async function mineTwentyStone(bot) {
  const stone = bot.findBlock({
    matching: b => b.name === 'stone',
    maxDistance: 32
  });
  if (!stone) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'stone',
        maxDistance: 32
      });
    });
  }
  await mineBlock('stone', 20);
}