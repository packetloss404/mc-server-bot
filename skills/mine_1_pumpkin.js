async function mineOnePumpkin(bot) {
  let pumpkin = bot.findBlock({
    matching: b => b.name === 'pumpkin',
    maxDistance: 32
  });
  if (!pumpkin) {
    await exploreUntil('north', 120, () => {
      return bot.findBlock({
        matching: b => b.name === 'pumpkin',
        maxDistance: 32
      });
    });
  }
  await mineBlock('pumpkin', 1);
}