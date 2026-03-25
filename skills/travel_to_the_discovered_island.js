async function travelToDiscoveredIsland(bot) {
  // The task is to travel to a discovered island. 
  // Since specific coordinates aren't provided in the prompt, we use the logic of exploring the ocean to find land.
  const searchDirection = {
    x: 1,
    y: 0,
    z: 0
  };

  // Step 1: Find water and move to it to start the crossing
  let waterBlock = bot.findBlock({
    matching: b => b.name === 'water',
    maxDistance: 32
  });
  if (!waterBlock) {
    waterBlock = await exploreUntil(searchDirection, 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'water',
        maxDistance: 32
      });
    });
  }
  if (waterBlock) {
    await moveTo(waterBlock.position.x, waterBlock.position.y, waterBlock.position.z, 2);
  }

  // Step 2: Explore across the water to find a new landmass (the island)
  // We look for land blocks that are at a distance from our starting point
  const startPos = bot.entity.position.clone();
  const islandBlock = await exploreUntil(searchDirection, 120, () => {
    const land = bot.findBlock({
      matching: b => ['grass_block', 'sand', 'dirt', 'stone', 'gravel', 'oak_log', 'spruce_log'].includes(b.name),
      maxDistance: 32
    });
    // Check if the land found is at least 20 blocks away from where we started the water crossing
    if (land && land.position.distanceTo(startPos) > 20) {
      return land;
    }
    return null;
  });

  // Step 3: Move to the discovered island
  if (islandBlock) {
    await moveTo(islandBlock.position.x, islandBlock.position.y, islandBlock.position.z, 2);
  }
}