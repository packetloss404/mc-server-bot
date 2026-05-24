async function gather_food_for_town(bot) {
  const inv = bot.inventory.items();
  const edibleFood = inv.filter(i => i.foodRecovery > 0);

  // Check if we already have food
  if (edibleFood.length > 0) {
    const totalFood = edibleFood.reduce((sum, i) => sum + i.count, 0);
    if (totalFood >= 8) {
      // Deposit food to town - find town chest location
      await exploreUntil('forward', 15, () => {
        return bot.findBlock({
          matching: b => b.name === 'chest',
          maxDistance: 16
        });
      });
      const townChest = bot.findBlock({
        matching: b => b.name === 'chest',
        maxDistance: 16
      });
      if (!townChest) { console.log("Block not found"); return; }
      if (townChest) {
        await moveTo(townChest.position.x, townChest.position.y, townChest.position.z, 3, 10);
        for (const food of edibleFood) {
          await depositItem('chest', food.name, food.count);
        }
      }
      return;
    }
  }

  // Explore to find food sources - try different directions
  let foodSource = null;

  // Try to find any food crop block
  const directions = ['north', 'east', 'south', 'west'];
  for (const dir of directions) {
    foodSource = bot.findBlock({
      matching: b => ['wheat', 'carrot', 'potato', 'beetroot'].includes(b.name),
      maxDistance: 32
    });
    if (foodSource) break;
    await exploreUntil(dir, 20, () => {
      return bot.findBlock({
        matching: b => ['wheat', 'carrot', 'potato', 'beetroot', 'farmland', 'carrot_block', 'potato_block'].includes(b.name),
        maxDistance: 32
      });
    });
    foodSource = bot.findBlock({
      matching: b => ['wheat', 'carrot', 'potato', 'beetroot'].includes(b.name),
      maxDistance: 32
    });
    if (foodSource) break;
  }

  // If no crops, look for village or other food sources
  if (!foodSource) {
    await exploreUntil('forward', 25, () => {
      return bot.findBlock({
        matching: b => b.name === 'oak_leaves' || b.name === 'dark_oak_leaves' || b.name === 'birch_leaves',
        maxDistance: 32
      });
    });
  }

  // Harvest any found food crops
  const crops = ['wheat', 'carrot', 'potato', 'beetroot'];
  for (const crop of crops) {
    let block = bot.findBlock({
      matching: b => b.name === crop,
      maxDistance: 32
    });
    if (!block) { console.log("Block not found"); return; }
    while (block) {
      await moveTo(block.position.x, block.position.y, block.position.z, 3, 10);
      await mineBlock(crop, 64);
      block = bot.findBlock({
        matching: b => b.name === crop,
        maxDistance: 32
      });
    }
  }

  // Check for apples from leaf blocks
  const leaves = bot.findBlock({
    matching: b => ['oak_leaves', 'dark_oak_leaves', 'birch_leaves'].includes(b.name),
    maxDistance: 32
  });
  if (leaves) {
    await moveTo(leaves.position.x, leaves.position.y, leaves.position.z, 3, 10);
    await mineBlock('oak_leaves', 32);
    await mineBlock('dark_oak_leaves', 32);
    await mineBlock('birch_leaves', 32);
  }

  // Check inventory for food now
  const currentFood = bot.inventory.items().filter(i => i.foodRecovery > 0);
  const totalFood = currentFood.reduce((sum, i) => sum + i.count, 0);

  // If still not enough food, find a village or make a farm
  if (totalFood < 8) {
    // Try to find a village
    await exploreUntil('forward', 30, () => {
      return bot.findBlock({
        matching: b => ['oak_log', 'spruce_log', 'birch_log'].includes(b.name) && bot.findBlocks({
          matching: bb => bb.name === 'chest',
          maxDistance: 8,
          count: 3
        }).length >= 2,
        maxDistance: 32
      });
    });

    // Check nearby chests for food
    const chests = bot.findBlocks({
      matching: b => b.name === 'chest',
      maxDistance: 32,
      count: 8
    });
    for (const chest of chests) {
      await moveTo(chest.position.x, chest.position.y, chest.position.z, 3, 10);
      await withdrawItem('chest', 'bread', 8);
      await withdrawItem('chest', 'cooked_food', 8);
      await withdrawItem('chest', 'apple', 8);
    }
  }

  // Final deposit to town
  await exploreUntil('forward', 15, () => {
    return bot.findBlock({
      matching: b => b.name === 'chest',
      maxDistance: 16
    });
  });
  const finalChest = bot.findBlock({
    matching: b => b.name === 'chest',
    maxDistance: 16
  });
  if (!finalChest) { console.log("Block not found"); return; }
  if (finalChest) {
    await moveTo(finalChest.position.x, finalChest.position.y, finalChest.position.z, 3, 10);
    const finalFood = bot.inventory.items().filter(i => i.foodRecovery > 0);
    for (const food of finalFood) {
      await depositItem('chest', food.name, food.count);
    }
  }
}