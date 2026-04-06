async function mineTenDioriteBlocks(bot) {
  const diorite = bot.findBlock({
    matching: b => b.name === 'diorite',
    maxDistance: 32
  });
  if (!diorite) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'diorite',
        maxDistance: 32
      });
    });
  }
  await mineBlock('diorite', 10);
}