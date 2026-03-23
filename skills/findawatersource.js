async function findWaterSource(bot) {
  let water = bot.findBlock({
    matching: b => b.name === 'water',
    maxDistance: 32
  });
  if (!water) {
    await exploreUntil({
      x: 1,
      y: 0,
      z: 1
    }, 60000, () => {
      water = bot.findBlock({
        matching: b => b.name === 'water',
        maxDistance: 32
      });
      return water;
    });
  }
  if (water) {
    await moveTo(water.position.x, water.position.y, water.position.z, 3);
  }
}