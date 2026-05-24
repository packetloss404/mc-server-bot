async function gather_food_for_town(bot) {
  // Check current food in inventory
  let inv = bot.inventory.items();
  let food = inv.filter(i => i.foodRecovery > 0);
  let totalFood = food.reduce((sum, f) => sum + f.count, 0);
  console.log(`Current food: ${totalFood} items`);

  // If we have food, try to deposit to town
  if (totalFood > 0) {
    for (const f of food) {
      await depositItem('town_mph4x8tz_e3237864', f.name, f.count);
      await bot.waitForTicks(5);
    }
  }

  // Need 3 more food to reach 8
  if (totalFood < 8) {
    // Find oak logs (apple trees nearby)
    let oakLog = bot.findBlock({
      matching: b => b.name === 'oak_log',
      maxDistance: 32
    });
    if (!oakLog) { console.log("Block not found"); return; }
    if (oakLog) {
      await moveTo(oakLog.position.x, oakLog.position.y + 1, oakLog.position.z, 3, 15);
      await mineBlock('oak_log', 2);
    }

    // Check for apples from trees
    inv = bot.inventory.items();
    let apples = inv.find(i => i.name === 'apple');
    if (apples) {
      await depositItem('town_mph4x8tz_e3237864', 'apple', apples.count);
    }

    // Explore to find more food (mushrooms, berries, etc.)
    await exploreUntil('forward', 20, () => {
      return bot.findBlock({
        matching: b => b.name === 'brown_mushroom' || b.name === 'red_mushroom' || b.name === 'sweet_berry_bush',
        maxDistance: 32
      });
    });

    // Mine mushrooms if found
    let mushroom = bot.findBlock({
      matching: b => b.name === 'brown_mushroom' || b.name === 'red_mushroom',
      maxDistance: 5
    });
    if (!mushroom) { console.log("Block not found"); return; }
    if (mushroom) {
      await mineBlock(mushroom.name, 5);
    }

    // Mine sweet berries if found
    let berries = bot.findBlock({
      matching: b => b.name === 'sweet_berry_bush',
      maxDistance: 5
    });
    if (!berries) { console.log("Block not found"); return; }
    if (berries) {
      await mineBlock('sweet_berry_bush', 3);
    }

    // Deposit remaining food
    inv = bot.inventory.items();
    food = inv.filter(i => i.foodRecovery > 0);
    for (const f of food) {
      await depositItem('town_mph4x8tz_e3237864', f.name, f.count);
      await bot.waitForTicks(5);
    }
  }
}