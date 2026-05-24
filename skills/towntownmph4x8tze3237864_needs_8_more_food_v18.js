async function gather_food_for_town(bot) {
  // Find the town chest by exploring
  await exploreUntil('south', 30, () => {
    return bot.findBlock({
      matching: b => b.name === 'chest',
      maxDistance: 5
    });
  });

  // Find the town chest
  const townChest = bot.findBlock({
    matching: b => b.name === 'chest',
    maxDistance: 32
  });
  if (!townChest) {
    // Try moving toward known world position
    await moveTo(1140, 63, 218, 3, 20);
    await exploreUntil('north', 30, () => {
      return bot.findBlock({
        matching: b => b.name === 'chest',
        maxDistance: 5
      });
    });
  }

  // Get town chest position and move to it
  const chest = bot.findBlock({
    matching: b => b.name === 'chest',
    maxDistance: 32
  });
  if (!chest) { console.log("Block not found"); return; }
  if (chest) {
    const chestPos = chest.position;
    await moveTo(chestPos.x, chestPos.y, chestPos.z, 3, 20);

    // Deposit food
    const inv = bot.inventory.items();
    const foodItems = inv.filter(i => i.foodRecovery > 0);
    for (const food of foodItems) {
      await depositItem('town_mph4x8tz_e3237864', food.name, food.count);
    }
  }
}