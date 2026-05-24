async function tend_crops_plant_seeds_and(bot) {
  // Check inventory for seeds first
  const inv = bot.inventory.items();
  const seeds = inv.find(i => i.name === 'wheat_seeds');
  const seedCount = seeds ? seeds.count : 0;

  // Try to find farmland nearby
  let farmland = bot.findBlock({
    matching: b => b.name === 'farmland',
    maxDistance: 32
  });

  // If no farmland, explore to find one
  if (!farmland) {
    farmland = await exploreUntil('forward', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'farmland',
        maxDistance: 32
      });
    });
  }

  // If still no farmland, check if there's a village with farms
  if (!farmland) {
    // Explore further for village farmland
    const villageFarmland = await exploreUntil('forward', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'farmland',
        maxDistance: 32
      });
    });
    if (villageFarmland) farmland = villageFarmland;
  }
  if (!farmland) {
    return; // No farmland available
  }

  // Move to farmland area
  await moveTo(farmland.position.x, farmland.position.y + 1, farmland.position.z, 2, 15);

  // Harvest mature wheat (stage 7)
  const wheatBlocks = bot.findBlocks({
    matching: b => b.name === 'wheat',
    maxDistance: 5,
    count: 64
  });
  for (const wheatBlock of wheatBlocks) {
    try {
      const props = wheatBlock.getProperties();
      if (props && props.age >= 7) {
        await mineBlock('wheat', 1);
      }
    } catch (e) {
      // Block may have changed
    }
  }

  // Recheck seeds after harvesting
  const invAfter = bot.inventory.items();
  const seedsAfter = invAfter.find(i => i.name === 'wheat_seeds');
  const availableSeeds = seedsAfter ? seedsAfter.count : 0;

  // Find empty farmland to plant
  if (availableSeeds > 0) {
    const emptyFarmland = bot.findBlocks({
      matching: b => b.name === 'farmland',
      maxDistance: 5,
      count: 64
    }).find(pos => {
      const above = bot.blockAt(pos.offset(0, 1, 0));
      return !above || above.name === 'air';
    });
    if (emptyFarmland) {
      await moveTo(emptyFarmland.x, emptyFarmland.y + 1, emptyFarmland.z, 1, 10);
      const seedItem = bot.inventory.items().find(i => i.name === 'wheat_seeds');
      if (seedItem) {
        await bot.equip(seedItem, 'hand');
        await bot.placeBlock(emptyFarmland.offset(0, 1, 0));
      }
    }
  }
}