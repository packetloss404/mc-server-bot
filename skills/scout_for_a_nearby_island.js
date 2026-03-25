async function scoutForNearbyIsland(bot) {
  const startPosition = bot.entity.position.clone();
  const direction = {
    x: 0,
    y: 0,
    z: -1
  };

  // Step 1: Find water to start crossing
  let waterBlock = bot.findBlock({
    matching: b => b.name === 'water',
    maxDistance: 32
  });
  if (!waterBlock) {
    waterBlock = await exploreUntil(direction, 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'water',
        maxDistance: 32
      });
    });
  }
  if (waterBlock) {
    await moveTo(waterBlock.position.x, waterBlock.position.y, waterBlock.position.z, 2);
  }

  // Step 2: Explore across the water to find a new landmass (potential island)
  // We look for land blocks that are at least 40 blocks away from our starting point
  const islandBlock = await exploreUntil(direction, 300, () => {
    const land = bot.findBlock({
      matching: b => ['grass_block', 'sand', 'dirt', 'stone', 'gravel', 'clay', 'podzol', 'mycelium'].includes(b.name),
      maxDistance: 32
    });
    if (land && land.position.distanceTo(startPosition) > 40) {
      return land;
    }
    return null;
  });
  if (islandBlock) {
    await moveTo(islandBlock.position.x, islandBlock.position.y, islandBlock.position.z, 2);
  }
}