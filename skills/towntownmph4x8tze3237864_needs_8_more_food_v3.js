async function tend_crops_plant_seeds_and(bot) {
  // Find surface with grass and water for farming
  const targetBlock = await exploreUntil('up', 30, () => {
    const pos = bot.entity.position;
    for (let y = pos.y + 15; y >= pos.y - 5; y--) {
      const block = bot.blockAt(pos.offset(0, y - pos.y, 0));
      if (block && (block.name === 'grass_block' || block.name === 'dirt')) {
        return block;
      }
    }
    return null;
  });
  if (!targetBlock) {
    await exploreUntil('forward', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'grass_block' || b.name === 'dirt',
        maxDistance: 32
      });
    });
  }

  // Find water nearby for irrigation
  let water = bot.findBlock({
    matching: b => b.name === 'water',
    maxDistance: 16
  });

  // If no water, explore to find some
  if (!water) {
    await exploreUntil('forward', 20, () => {
      return bot.findBlock({
        matching: b => b.name === 'water',
        maxDistance: 32
      });
    });
    water = bot.findBlock({
      matching: b => b.name === 'water',
      maxDistance: 16
    });
  }

  // Find or create farmland
  const farmlandPos = water ? water.position.offset(3, 0, 0) : bot.entity.position.offset(3, 0, 0);
  await moveTo(farmlandPos.x, farmlandPos.y, farmlandPos.z, 3, 15);

  // Check for seeds in inventory
  let inv = bot.inventory.items();
  let seeds = inv.find(i => i.name === 'wheat_seeds');

  // If no seeds, craft them from wheat or find wheat to harvest
  if (!seeds) {
    // Check for wheat to harvest first
    const wheatBlock = bot.findBlock({
      matching: b => b.name === 'wheat' && b.getProperties().age >= 7,
      maxDistance: 16
    });
    if (wheatBlock) {
      await mineBlock('wheat', 1);
    }

    // Look for any food items nearby
    const foodBlock = bot.findBlock({
      matching: b => b.name === 'wheat' || b.name === 'carrots' || b.name === 'potatoes' || b.name === 'beetroot',
      maxDistance: 16
    });
    if (!foodBlock) { console.log("Block not found"); return; }
    if (foodBlock) {
      await mineBlock(foodBlock.name, 1);
    }
    inv = bot.inventory.items();
    seeds = inv.find(i => i.name === 'wheat_seeds');
  }

  // Get dirt blocks for farmland creation
  const dirtBlocks = [];
  for (let x = -3; x <= 3; x++) {
    for (let z = -3; z <= 3; z++) {
      const block = bot.blockAt(bot.entity.position.offset(x, -1, z));
      if (block && (block.name === 'dirt' || block.name === 'grass_block')) {
        dirtBlocks.push(block.position);
      }
    }
  }

  // Till the dirt to create farmland
  const hoe = inv.find(i => i.name.includes('hoe'));
  if (hoe) {
    await bot.equip(hoe, 'hand');
    for (const pos of dirtBlocks.slice(0, 8)) {
      const block = bot.blockAt(pos);
      if (block && (block.name === 'dirt' || block.name === 'grass_block')) {
        await placeItem('dirt', pos.x, pos.y, pos.z);
        await bot.waitForTicks(5);
      }
    }
  }

  // Plant seeds if available
  if (seeds) {
    await bot.equip(seeds, 'hand');
    for (const pos of dirtBlocks.slice(0, 6)) {
      const block = bot.blockAt(pos);
      if (block && block.name === 'farmland') {
        await placeItem('wheat_seeds', pos.x, pos.y + 1, pos.z);
        await bot.waitForTicks(5);
      }
    }
  }

  // Wait for crops to grow (wheat grows in ~4 minutes, wait ~60 seconds)
  await bot.waitForTicks(600);

  // Harvest mature wheat
  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) {
      const block = bot.blockAt(bot.entity.position.offset(x, 0, z));
      if (block && block.name === 'wheat') {
        const props = block.getProperties();
        if (props && props.age >= 7) {
          await mineBlock('wheat', 1);
        }
      }
    }
  }

  // Collect all food items
  inv = bot.inventory.items();
  const foodItems = inv.filter(i => i.name === 'wheat' || i.name === 'carrots' || i.name === 'potatoes' || i.name === 'beetroot' || i.name === 'bread' || i.foodRecovery > 0);
  let foodCount = foodItems.reduce((sum, i) => sum + (i.foodRecovery > 0 ? i.count : 0), 0);

  // If we have at least 8 food, find town and deliver
  if (foodCount >= 8 || foodItems.length > 0) {
    await exploreUntil('forward', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'oak_planks' || b.name === 'oak_log' || b.name.includes('chest'),
        maxDistance: 32
      });
    });

    // Find town chest and deposit food
    const townChest = bot.findBlock({
      matching: b => b.name.includes('chest'),
      maxDistance: 8
    });
    if (townChest) {
      for (const item of foodItems) {
        await depositItem('chest', item.name, item.count);
      }
    }
  }
}