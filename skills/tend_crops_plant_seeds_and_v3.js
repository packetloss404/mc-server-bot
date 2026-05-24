async function tend_crops_plant_seeds_and(bot) {
  // Explore to find farmland with crops
  const farmland = await exploreUntil('forward', 30, () => {
    return bot.findBlock({
      matching: b => b.name === 'farmland',
      maxDistance: 32
    });
  });
  if (!farmland) {
    return; // No farmland found
  }

  // Move to farmland area
  await moveTo(farmland.position.x, farmland.position.y + 1, farmland.position.z, 3, 15);

  // Get nearby blocks once for efficiency
  const nearbyBlocks = [];
  for (let x = -5; x <= 5; x++) {
    for (let z = -5; z <= 5; z++) {
      const pos = bot.entity.position.offset(x, 0, z);
      const block = bot.blockAt(pos);
      if (block) nearbyBlocks.push(block);
    }
  }

  // Harvest mature wheat (stage 7)
  for (const block of nearbyBlocks) {
    if (block.name === 'wheat') {
      const props = block.getProperties();
      if (props && props.age >= 7) {
        await mineBlock('wheat', 1);
      }
    }
  }

  // Check inventory for seeds
  const inv = bot.inventory.items();
  const seeds = inv.find(i => i.name === 'wheat_seeds');
  if (seeds && seeds.count > 0) {
    // Find empty farmland to plant on
    for (const block of nearbyBlocks) {
      if (block.name === 'farmland') {
        const above = bot.blockAt(block.position.offset(0, 1, 0));
        if (!above || above.name === 'air') {
          await moveTo(block.position.x, block.position.y + 1, block.position.z, 1.5, 5);
          await placeItem('wheat_seeds', block.position.x, block.position.y + 1, block.position.z);
        }
      }
    }
  }

  // Eat food if needed
  if (bot.food < 19) {
    const food = bot.inventory.items().find(i => i.foodRecovery > 0);
    if (food) {
      await bot.equip(food, 'hand');
      await Promise.race([bot.consume(), new Promise(r => setTimeout(r, 5000))]);
    }
  }
}