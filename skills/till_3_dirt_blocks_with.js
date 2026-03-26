async function tillDirtBlocksNearWater(bot) {
  // First, find and move to the water source at 1040,62,232
  const waterPos = {
    x: 1040,
    y: 62,
    z: 232
  };
  await moveTo(waterPos.x, waterPos.y, waterPos.z, 2, 30);

  // Check if we have a stone hoe, if not craft one
  let stoneHoe = bot.inventory.items().find(i => i.name === 'stone_hoe');
  if (!stoneHoe) {
    // Mine stone if needed
    const stoneInInv = bot.inventory.items().find(i => i.name === 'stone');
    if (!stoneInInv || stoneInInv.count < 1) {
      await mineBlock('stone', 1);
    }
    // Craft stone hoe (requires 3 stone + 2 sticks)
    const sticksInInv = bot.inventory.items().find(i => i.name === 'stick');
    if (!sticksInInv || sticksInInv.count < 2) {
      await craftItem('stick', 2);
    }
    await craftItem('stone_hoe', 1);
  }

  // Equip the stone hoe
  stoneHoe = bot.inventory.items().find(i => i.name === 'stone_hoe');
  if (stoneHoe) {
    await bot.equip(stoneHoe, 'hand');
  }

  // Till 3 dirt blocks near the water source
  // Search for dirt blocks in a radius around the water
  let tilledCount = 0;
  for (let dx = -2; dx <= 2 && tilledCount < 3; dx++) {
    for (let dz = -2; dz <= 2 && tilledCount < 3; dz++) {
      const dirtBlock = bot.findBlock({
        matching: b => b.name === 'dirt' || b.name === 'grass_block',
        maxDistance: 32,
        point: {
          x: waterPos.x + dx,
          y: waterPos.y,
          z: waterPos.z + dz
        }
      });
      if (dirtBlock) {
        await moveTo(dirtBlock.position.x, dirtBlock.position.y, dirtBlock.position.z, 1, 10);
        await bot.dig(dirtBlock);
        await placeItem('farmland', dirtBlock.position.x, dirtBlock.position.y, dirtBlock.position.z);
        tilledCount++;
      }
    }
  }
}