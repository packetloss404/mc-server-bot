async function findFoodAndEat(bot) {
  if (bot.food > 15) {
    // Hunger is above 15, no need to eat right now.
    return;
  }
  const food = bot.inventory.items().find(i => i.foodRecovery > 0);
  if (food) {
    await bot.equip(food, "hand");
    await bot.consume();
  } else {
    // No food in inventory. Need to acquire some.
    // For this task, we only focus on eating existing food.
    // Future tasks might involve farming or hunting.
    // Since there's no specific instruction on how to get food if none is found,
    // we will just return.
    // A more advanced bot might start looking for wheat, animals, etc.
  }
}