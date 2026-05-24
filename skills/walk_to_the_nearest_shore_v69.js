async function walkToTheNearestShore(bot) {
  // Check if bot is actually in water
  const feetBlock = bot.blockAt(bot.entity.position);
  const isInWater = feetBlock && (feetBlock.name.includes('water') || feetBlock.name.includes('lava') || feetBlock.name === 'bubble_column');
  if (!isInWater) {
    return;
  }

  // Find nearby land blocks
  const landBlocks = bot.findBlocks({
    matching: b => ['grass_block', 'dirt', 'sand', 'stone', 'gravel', 'podzol'].includes(b.name),
    maxDistance: 32,
    count: 8
  });
  if (landBlocks.length > 0) {
    // Sort by distance (findBlocks doesn't guarantee order)
    const sorted = landBlocks.sort((a, b) => {
      const distA = bot.entity.position.distanceTo(a.position);
      const distB = bot.entity.position.distanceTo(b.position);
      return distA - distB;
    });
    const target = sorted[0];
    await moveTo(target.x, target.y, target.z, 2, 30);

    // If still in water after moving, use swim controls
    const stillInWater = bot.blockAt(bot.entity.position);
    if (stillInWater && (stillInWater.name.includes('water') || stillInWater.name.includes('lava'))) {
      bot.setControlState('forward', true);
      bot.setControlState('jump', true);
      await bot.waitForTicks(40);
      bot.clearControlStates();
    }
  } else {
    // Explore to find land
    await exploreUntil('south', 15, () => {
      return bot.findBlocks({
        matching: b => ['grass_block', 'dirt', 'sand', 'stone', 'gravel', 'podzol'].includes(b.name),
        maxDistance: 32,
        count: 1
      })[0];
    });
  }
}