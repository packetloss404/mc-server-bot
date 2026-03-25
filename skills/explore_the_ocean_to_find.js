async function exploreOceanToFindIsland(bot) {
  const startPos = bot.entity.position.clone();
  const searchDirection = {
    x: 0,
    y: 0,
    z: -1
  };

  // Step 1: Find water and move to it
  let waterBlock = bot.findBlock({
    matching: b => b.name === 'water',
    maxDistance: 32
  });
  if (!waterBlock) {
    await exploreUntil(searchDirection, 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'water',
        maxDistance: 32
      });
    });
    waterBlock = bot.findBlock({
      matching: b => b.name === 'water',
      maxDistance: 32
    });
  }
  if (waterBlock) {
    await moveTo(waterBlock.position.x, waterBlock.position.y, waterBlock.position.z, 2);
  }

  // Step 2: Explore across the water to find a new landmass (potential island)
  // We look for land blocks (grass, sand, dirt, logs) that are a significant distance away from the start
  await exploreUntil(searchDirection, 120, () => {
    const landBlock = bot.findBlock({
      matching: b => ['grass_block', 'sand', 'dirt', 'oak_log', 'stone', 'gravel'].includes(b.name),
      maxDistance: 32
    });
    if (landBlock) {
      const distance = landBlock.position.distanceTo(startPos);
      // If we found land more than 64 blocks away from start, it's likely a new island or shore
      if (distance > 64) {
        return landBlock;
      }
    }
    return null;
  });

  // Step 3: Move onto the found land
  const islandBlock = bot.findBlock({
    matching: b => ['grass_block', 'sand', 'dirt', 'oak_log', 'stone', 'gravel'].includes(b.name),
    maxDistance: 32
  });
  if (islandBlock) {
    await moveTo(islandBlock.position.x, islandBlock.position.y, islandBlock.position.z, 1);
  }
}