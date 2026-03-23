async function findNearestWaterAndWalkToIt(bot) {
  const waterBlock = bot.findBlock({
    matching: b => b.name === 'water',
    maxDistance: 32
  });
  if (waterBlock) {
    await moveTo(waterBlock.position.x, waterBlock.position.y, waterBlock.position.z, 1, 30);
  } else {
    await exploreUntil('forward', 60000, () => {
      return bot.findBlock({
        matching: b => b.name === 'water',
        maxDistance: 32
      });
    });
    const foundWater = bot.findBlock({
      matching: b => b.name === 'water',
      maxDistance: 32
    });
    if (foundWater) {
      await moveTo(foundWater.position.x, foundWater.position.y, foundWater.position.z, 1, 30);
    }
  }
}