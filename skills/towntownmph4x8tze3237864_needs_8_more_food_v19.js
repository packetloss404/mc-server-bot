async function gather_food_for_town(bot) {
  const inv = bot.inventory.items();
  const foodItems = inv.filter(i => i.foodRecovery > 0);
  if (foodItems.length < 8) {
    // Explore to find wheat or crops (farmer's specialty)
    const wheatBlock = await exploreUntil('north', 20, () => {
      return bot.findBlock({
        matching: b => b.name === 'wheat',
        maxDistance: 32
      });
    });
    if (wheatBlock) {
      // Found wheat, harvest it
      await moveTo(wheatBlock.position.x, wheatBlock.position.y, wheatBlock.position.z, 3, 10);
      await mineBlock('wheat', 8);
    }

    // Check inventory again for wheat
    let wheatCount = bot.inventory.items().filter(i => i.name === 'wheat').reduce((sum, i) => sum + i.count, 0);

    // If not enough wheat, try finding village farmland
    if (wheatCount < 8) {
      const farmlandBlock = await exploreUntil('east', 20, () => {
        return bot.findBlock({
          matching: b => b.name === 'farmland' || b.name === 'carrots' || b.name === 'potatoes',
          maxDistance: 32
        });
      });
      if (farmlandBlock) {
        await moveTo(farmlandBlock.position.x, farmlandBlock.position.y, farmlandBlock.position.z, 3, 10);
        if (farmlandBlock.name === 'carrots') await mineBlock('carrots', 8);else if (farmlandBlock.name === 'potatoes') await mineBlock('potatoes', 8);
      }
    }

    // Craft bread from wheat if we have enough
    const currentWheat = bot.inventory.items().filter(i => i.name === 'wheat').reduce((sum, i) => sum + i.count, 0);
    if (currentWheat >= 3) {
      await craftItem('bread', Math.floor(currentWheat / 3));
    }

    // If still no food, explore for animals
    const remainingFood = bot.inventory.items().filter(i => i.foodRecovery > 0);
    if (remainingFood.length === 0) {
      const animal = await exploreUntil('south', 20, () => {
        return bot.nearestEntity(e => ['cow', 'pig', 'sheep', 'chicken', 'rabbit'].includes(e.name));
      });
      if (animal) {
        await killMob(animal.name, 15000);
      }
    }
  }

  // Deposit all food to town chest
  const finalFood = bot.inventory.items().filter(i => i.foodRecovery > 0);
  for (const food of finalFood) {
    await depositItem('town_mph4x8tz_e3237864', food.name, food.count);
  }
}