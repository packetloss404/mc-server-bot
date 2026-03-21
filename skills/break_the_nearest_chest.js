async function breakNearestChest(bot) {
  const chest = bot.findBlock({
    matching: block => block.name === 'chest',
    maxDistance: 32
  });
  if (!chest) {
    await exploreUntil({
      x: 1,
      y: 0,
      z: 1
    }, 60, () => {
      return bot.findBlock({
        matching: block => block.name === 'chest',
        maxDistance: 32
      });
    });
  }
  await mineBlock('chest', 1);
}