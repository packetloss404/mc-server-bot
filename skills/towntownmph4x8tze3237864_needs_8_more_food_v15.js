async function gather_food_for_town(bot) {
  const inv = bot.inventory.items();
  const foodItems = inv.filter(i => i.foodRecovery > 0);
  const foodCount = foodItems.reduce((sum, i) => sum + i.count, 0);
  if (foodCount < 8) {
    // Explore and gather food from multiple sources
    for (let i = 0; i < 3; i++) {
      // Try brown mushrooms
      const mush = bot.findBlock({
        matching: b => b.name === 'brown_mushroom',
        maxDistance: 32
      });
      if (!mush) { console.log("Block not found"); return; }
      if (mush) {
        await mineBlock('brown_mushroom', 1);
      }

      // Try tall grass/seagrass
      const grass = bot.findBlock({
        matching: b => b.name === 'tall_seagrass' || b.name === 'short_grass',
        maxDistance: 32
      });
      if (!grass) { console.log("Block not found"); return; }
      if (grass) {
        await mineBlock(grass.name, 1);
      }

      // Try sugar cane
      const cane = bot.findBlock({
        matching: b => b.name === 'sugar_cane',
        maxDistance: 32
      });
      if (!cane) { console.log("Block not found"); return; }
      if (cane) {
        await mineBlock('sugar_cane', 1);
      }

      // Explore to find more food sources
      await exploreUntil('forward', 15, () => {
        const block = bot.findBlock({
          matching: b => b.name === 'brown_mushroom' || b.name === 'red_mushroom' || b.name === 'oak_leaves' || b.name === 'tall_seagrass',
          maxDistance: 32
        });
        if (!block) { console.log("Block not found"); return; }
        return block;
      });
    }

    // Try to find and kill animals if still not enough food
    const currentFood = bot.inventory.items().filter(i => i.foodRecovery > 0).reduce((sum, i) => sum + i.count, 0);
    if (currentFood < 8) {
      await exploreUntil('forward', 20, () => {
        const animal = bot.nearestEntity(e => e.name === 'sheep' || e.name === 'cow' || e.name === 'pig' || e.name === 'rabbit' || e.name === 'chicken');
        if (!animal) { console.log("Entity not found"); return; }
        return animal;
      });
      const animal = bot.nearestEntity(e => e.name === 'sheep' || e.name === 'cow' || e.name === 'pig' || e.name === 'rabbit' || e.name === 'chicken');
      if (!animal) { console.log("Entity not found"); return; }
      if (animal) {
        await killMob(animal.name, 10000);
      }
    }
  }

  // Deposit all food items to town
  const finalInv = bot.inventory.items();
  const finalFood = finalInv.filter(i => i.foodRecovery > 0);
  for (const food of finalFood) {
    await depositItem('town_mph4x8tz_e3237864', food.name, food.count);
  }
}