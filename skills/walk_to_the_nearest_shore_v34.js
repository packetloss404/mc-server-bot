async function walkToTheNearestShore(bot) {
  // First swim to the surface to escape drowning
  await swimToTheSurfaceDrowning(bot);

  // Check if still in water
  const isInWater = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && feetBlock.name.includes('water');
  };

  // Find land blocks: grass_block, dirt, sand, stone (not water)
  const landBlocks = [];
  const searchRadius = 16;
  const botPos = bot.entity.position;
  for (let dx = -searchRadius; dx <= searchRadius; dx++) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dz = -searchRadius; dz <= searchRadius; dz++) {
        const pos = botPos.offset(dx, dy, dz);
        const block = bot.blockAt(pos);
        if (block && (block.name === 'grass_block' || block.name === 'dirt' || block.name === 'sand' || block.name === 'stone')) {
          // Check if block is at or above water level and has air above it
          const blockAbove = bot.blockAt(pos.offset(0, 1, 0));
          if (blockAbove && !blockAbove.name.includes('water') && blockAbove.name !== 'lava') {
            landBlocks.push({
              block,
              dist: Math.sqrt(dx * dx + dz * dz)
            });
          }
        }
      }
    }
  }
  if (landBlocks.length === 0) {
    // Fallback: find any land block without water check
    const landBlock = bot.findBlock({
      matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
      maxDistance: 32
    });
    if (!landBlock) { console.log("Block not found"); return; }
    if (landBlock) {
      // Target the block adjacent to land (in the direction bot is coming from)
      await moveTo(landBlock.position.x, landBlock.position.y, landBlock.position.z, 2, 30);
    }
    return;
  }

  // Sort by distance and pick the closest
  landBlocks.sort((a, b) => a.dist - b.dist);
  const nearest = landBlocks[0].block;

  // Move to the land block
  await moveTo(nearest.position.x, nearest.position.y, nearest.position.z, 2, 30);

  // If still in water after moving, try moving forward to push out of water
  if (isInWater()) {
    bot.setControlState('forward', true);
    await bot.waitForTicks(20);
    bot.clearControlStates();
  }
}