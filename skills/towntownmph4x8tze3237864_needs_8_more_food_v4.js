async function gather_food_for_town(bot) {
  // Check inventory for existing food first
  let inv = bot.inventory.items();
  let food = inv.filter(i => i.foodRecovery > 0);
  if (food.length > 0) {
    // Deposit food to town
    const foodItem = food[0];
    await depositItem('town_mph4x8tz_e3237864', foodItem.name, Math.min(8, foodItem.count));
    return;
  }

  // Try to find farmland with crops nearby
  let farmland = bot.findBlock({
    matching: b => b.name === 'farmland' || b.name === 'grass_block' || b.name === 'dirt',
    maxDistance: 32
  });
  if (!farmland) { console.log("Block not found"); return; }
  if (farmland) {
    await moveTo(farmland.position.x, farmland.position.y + 1, farmland.position.z, 3, 15);
  }

  // Find water for farming setup
  let water = bot.findBlock({
    matching: b => b.name === 'water',
    maxDistance: 32
  });
  if (!water) { console.log("Block not found"); return; }

  // Explore to find farmland with crops or animals
  const foundTarget = await exploreUntil('forward', 30, () => {
    // Check for crops on farmland
    const cropPositions = [bot.entity.position.offset(1, 0, 0), bot.entity.position.offset(-1, 0, 0), bot.entity.position.offset(0, 0, 1), bot.entity.position.offset(0, 0, -1)];
    for (const pos of cropPositions) {
      const block = bot.blockAt(pos);
      if (block && (block.name === 'wheat' || block.name === 'carrots' || block.name === 'potatoes' || block.name === 'beetroots')) {
        return block;
      }
    }
    // Check for farmland
    return bot.findBlock({
      matching: b => b.name === 'farmland',
      maxDistance: 32
    });
  });
  if (foundTarget) {
    // Harvest any mature crops
    const nearby = [];
    for (let x = -6; x <= 6; x++) {
      for (let z = -6; z <= 6; z++) {
        const pos = bot.entity.position.offset(x, 0, z);
        const block = bot.blockAt(pos);
        if (block && (block.name === 'wheat' || block.name === 'carrots' || block.name === 'potatoes' || block.name === 'beetroots')) {
          nearby.push(block);
        }
      }
    }
    for (const crop of nearby) {
      await mineBlock(crop.name, 1);
      await bot.waitForTicks(5);
    }
  }

  // Check for animals nearby
  const animals = ['chicken', 'cow', 'pig', 'rabbit', 'sheep', 'mooshroom'];
  for (const animal of animals) {
    const mob = bot.nearestEntity(e => e.name === animal && e.position.distanceTo(bot.entity.position) < 32);
    if (mob) {
      await killMob(animal, 30000);
      break;
    }
  }

  // Check inventory for food and deposit to town
  inv = bot.inventory.items();
  food = inv.filter(i => i.foodRecovery > 0);
  if (food.length > 0) {
    for (const item of food) {
      await depositItem('town_mph4x8tz_e3237864', item.name, item.count);
    }
  }
}