async function gather_and_deliver_food_to_town(bot) {
  // Find farmland or crops first
  let targetFarmland = await exploreUntil('forward', 30, () => {
    return bot.findBlock({
      matching: b => b.name === 'farmland',
      maxDistance: 32
    });
  });
  if (!targetFarmland) {
    // Try exploring in multiple directions
    for (const dir of ['left', 'right', 'backward']) {
      targetFarmland = await exploreUntil(dir, 20, () => {
        return bot.findBlock({
          matching: b => b.name === 'farmland',
          maxDistance: 32
        });
      });
      if (targetFarmland) break;
    }
  }
  if (!targetFarmland) {
    // Look for wheat blocks directly
    const wheatBlock = await exploreUntil('forward', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'wheat',
        maxDistance: 32
      });
    });
    if (wheatBlock) {
      await moveTo(wheatBlock.position.x, wheatBlock.position.y + 1, wheatBlock.position.z, 3, 15);
    }
  } else {
    await moveTo(targetFarmland.position.x, targetFarmland.position.y + 1, targetFarmland.position.z, 3, 15);
  }

  // Collect wheat from nearby area
  for (let i = 0; i < 8; i++) {
    const wheat = bot.findBlock({
      matching: b => b.name === 'wheat',
      maxDistance: 32
    });
    if (!wheat) { console.log("Block not found"); return; }
    if (wheat) {
      await mineBlock('wheat', 1);
    } else {
      break;
    }
  }

  // Find town chest
  let townChest = await exploreUntil('forward', 30, () => {
    return bot.findBlock({
      matching: b => b.name === 'chest',
      maxDistance: 32
    });
  });
  if (!townChest) {
    for (const dir of ['left', 'right', 'backward']) {
      townChest = await exploreUntil(dir, 20, () => {
        return bot.findBlock({
          matching: b => b.name === 'chest',
          maxDistance: 32
        });
      });
      if (townChest) break;
    }
  }
  if (townChest) {
    await moveTo(townChest.position.x, townChest.position.y + 1, townChest.position.z, 3, 15);

    // Check inventory for food items and deposit them
    const inv = bot.inventory.items();
    const foodItems = ['wheat', 'carrot', 'potato', 'bread', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'cooked_rabbit', 'rabbit_stew', 'beetroot', 'beetroot_soup', 'pumpkin', 'melon_slice', 'apple', 'golden_apple', 'cookie'];
    for (const item of inv) {
      if (foodItems.includes(item.name)) {
        await depositItem('chest', item.name, item.count);
      }
    }
  }
}