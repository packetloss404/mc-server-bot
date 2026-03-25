async function swimToFindIsland(bot) {
  const startPos = bot.entity.position.clone();

  // Based on world memory, water is to the East (832, 60, 421) from (803, 60, 422).
  const direction = {
    x: 1,
    y: 0,
    z: 0
  };

  // Explore in the chosen direction until we find land that is far from the start
  const targetLand = await exploreUntil(direction, 120000, () => {
    const landBlock = bot.findBlock({
      matching: b => ['grass_block', 'sand', 'dirt', 'stone', 'gravel', 'snow_block', 'podzol', 'coarse_dirt'].includes(b.name),
      maxDistance: 32
    });
    if (landBlock) {
      // Check if this land is at least 50 blocks away from where we started to ensure it's a separate landmass/island
      const distance = landBlock.position.distanceTo(startPos);
      if (distance > 50) {
        return landBlock;
      }
    }
    return null;
  });
  if (targetLand) {
    await moveTo(targetLand.position.x, targetLand.position.y + 1, targetLand.position.z, 2, 60);
  }
}