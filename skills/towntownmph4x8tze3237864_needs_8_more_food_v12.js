async function gather_food_for_town(bot) {
  // Collect all food from inventory and deposit to town
  const inv = bot.inventory.items();
  const foodItems = inv.filter(i => i.foodRecovery > 0);
  if (foodItems.length === 0) {
    // No food in inventory, need to find food sources
    await exploreUntil('forward', 30, () => {
      const animals = bot.nearestEntity(e => e.name === 'sheep' || e.name === 'cow' || e.name === 'pig' || e.name === 'rabbit' || e.name === 'chicken');
      if (!animals) { console.log("Entity not found"); return; }
      return animals;
    });
    const animal = bot.nearestEntity(e => e.name === 'sheep' || e.name === 'cow' || e.name === 'pig' || e.name === 'rabbit' || e.name === 'chicken');
    if (!animal) { console.log("Entity not found"); return; }
    if (animal) {
      await killMob(animal.name, 10000);
    }
  }

  // Deposit all food items to town
  const invAfter = bot.inventory.items();
  const foodAfter = invAfter.filter(i => i.foodRecovery > 0);
  for (const food of foodAfter) {
    await depositItem('town_mph4x8tz_e3237864', food.name, food.count);
  }
}