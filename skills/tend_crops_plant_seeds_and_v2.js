async function tend_crops_plant_seeds_and(bot) {
  // First try exploring to find farmland
  const farmland = await exploreUntil('forward', 30, () => {
    return bot.findBlock({
      matching: b => b.name === 'farmland',
      maxDistance: 32
    });
  });

  // If no farmland found forward, try other directions
  let farmlandBlock = farmland;
  if (!farmlandBlock) {
    const farmlandNorth = await exploreUntil('north', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'farmland',
        maxDistance: 32
      });
    });
    farmlandBlock = farmlandNorth;
  }
  if (!farmlandBlock) {
    const farmlandEast = await exploreUntil('east', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'farmland',
        maxDistance: 32
      });
    });
    farmlandBlock = farmlandEast;
  }
  if (!farmlandBlock) {
    const farmlandSouth = await exploreUntil('south', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'farmland',
        maxDistance: 32
      });
    });
    farmlandBlock = farmlandSouth;
  }
  if (!farmlandBlock) {
    // Try back direction as last resort
    const farmlandWest = await exploreUntil('west', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'farmland',
        maxDistance: 32
      });
    });
    farmlandBlock = farmlandWest;
  }
  if (!farmlandBlock) {
    return; // No farmland found after all directions
  }

  // Move to farmland area
  await moveTo(farmlandBlock.position.x, farmlandBlock.position.y + 1, farmlandBlock.position.z, 3, 15);

  // Harvest any mature wheat first (mature wheat is stage 7)
  const nearbyWheat = bot.findBlocks({
    matching: b => b.name === 'wheat',
    maxDistance: 5,
    count: 64
  });
  for (const wheatBlock of nearbyWheat) {
    const properties = wheatBlock.getProperties();
    if (properties && properties.age >= 7) {
      await mineBlock('wheat', 1);
    }
  }

  // Also check for mature carrots and potatoes
  const nearbyCarrots = bot.findBlocks({
    matching: b => b.name === 'carrots',
    maxDistance: 5,
    count: 64
  });
  for (const carrotBlock of nearbyCarrots) {
    const properties = carrotBlock.getProperties();
    if (properties && properties.age >= 7) {
      await mineBlock('carrots', 1);
    }
  }
  const nearbyPotatoes = bot.findBlocks({
    matching: b => b.name === 'potatoes',
    maxDistance: 5,
    count: 64
  });
  for (const potatoBlock of nearbyPotatoes) {
    const properties = potatoBlock.getProperties();
    if (properties && properties.age >= 7) {
      await mineBlock('potatoes', 1);
    }
  }

  // Now check if we have seeds to plant
  const inv = bot.inventory.items();
  const seeds = inv.find(i => i.name === 'wheat_seeds');
  if (seeds && seeds.count > 0) {
    // Find empty farmland to plant on
    const emptyFarmland = bot.findBlocks({
      matching: b => b.name === 'farmland',
      maxDistance: 5,
      count: 64
    });
    for (const farmlandSpot of emptyFarmland) {
      // Check if there's no crop already planted
      const above = bot.blockAt(farmlandSpot.position.offset(0, 1, 0));
      if (!above || above.name === 'air') {
        // Place wheat seeds on farmland
        await placeItem('wheat_seeds', farmlandSpot.position.x, farmlandSpot.position.y + 1, farmlandSpot.position.z);
        const updatedInv = bot.inventory.items();
        const remainingSeeds = updatedInv.find(i => i.name === 'wheat_seeds');
        if (!remainingSeeds || remainingSeeds.count === 0) {
          break; // No more seeds
        }
      }
    }
  }
}