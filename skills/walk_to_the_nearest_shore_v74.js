async function walk_to_the_nearest_shore_v31(bot) {
  // First swim to surface if drowning
  await swimToTheSurfaceDrowning(bot);

  // Now find land
  const land = bot.findBlock({
    matching: b => b.name === 'grass_block' || b.name === 'dirt' || b.name === 'sand' || b.name === 'stone',
    maxDistance: 32
  });
  if (!land) return;

  // Try to move toward land
  const targetPos = land.position;
  const currentPos = bot.entity.position;

  // Check if there's water blocking the path
  const pathBlock = bot.blockAt(currentPos.offset(Math.sign(targetPos.x - currentPos.x), 0, Math.sign(targetPos.z - currentPos.z)));
  const isWaterBlocking = pathBlock && (pathBlock.name === 'water' || pathBlock.name === 'flowing_water' || pathBlock.name === 'bubble_column');
  if (isWaterBlocking) {
    // Place oak_planks to bridge across
    const planks = bot.inventory.items().find(i => i.name === 'oak_planks');
    if (planks) {
      const placePos = currentPos.offset(Math.sign(targetPos.x - currentPos.x) * 0.8, -0.5, Math.sign(targetPos.z - currentPos.z) * 0.8);
      await placeItem('oak_planks', Math.floor(placePos.x), Math.floor(placePos.y), Math.floor(placePos.z));
      await bot.waitForTicks(5);
    }
  }

  // Move toward land
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 2, 30);

  // If still in water after moving, try again with bridging
  const stillInWater = () => {
    const feetBlock = bot.blockAt(bot.entity.position);
    return feetBlock && (feetBlock.name === 'water' || feetBlock.name === 'flowing_water');
  };
  if (stillInWater()) {
    // Find nearest solid block in cardinal directions
    const directions = [{
      dx: 1,
      dz: 0
    }, {
      dx: -1,
      dz: 0
    }, {
      dx: 0,
      dz: 1
    }, {
      dx: 0,
      dz: -1
    }];
    for (const dir of directions) {
      const checkPos = bot.entity.position.offset(dir.dx, 0, dir.dz);
      const block = bot.blockAt(checkPos);
      if (block && block.name !== 'water' && block.name !== 'flowing_water') {
        await moveTo(checkPos.x, checkPos.y, checkPos.z, 1, 10);
        break;
      }
    }
  }
}