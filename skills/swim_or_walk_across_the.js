async function findSeparateLandmass(bot) {
  const startPos = bot.entity.position.clone();

  // Direction across the water based on known water location (852, 61, 424)
  // Current position is (854, 61, 425). Direction is roughly West (-1, 0, 0).
  const direction = {
    x: -1,
    y: 0,
    z: 0
  };

  // Explore in the chosen direction until we find land that is far from the start
  const targetLand = await exploreUntil(direction, 120000, () => {
    const landBlock = bot.findBlock({
      matching: b => ['grass_block', 'sand', 'dirt', 'stone', 'gravel', 'snow_block'].includes(b.name),
      maxDistance: 32
    });
    if (landBlock) {
      // Check if this land is at least 40 blocks away from where we started
      const distance = landBlock.position.distanceTo(startPos);
      if (distance > 40) {
        return landBlock;
      }
    }
    return null;
  });
  if (targetLand) {
    await moveTo(targetLand.position.x, targetLand.position.y, targetLand.position.z, 1, 60);
  }
}