async function findAndEatFoodUrgently(bot) {
  // First, check if the bot actually has food in its inventory.
  const food = bot.inventory.items().find(i => i.foodRecovery > 0);
  if (food) {
    // If food is found, equip it and consume it.
    await bot.equip(food, 'hand');
    await bot.consume();
  } else {
    // If no food is found in inventory, the bot needs to acquire some.
    // Since the main problem is low health, and hunger is full, eating only helps if it's a golden apple/carrot or if hunger drops.
    // However, the task specifically asks to "Find and eat food urgently".
    // If no food is in inventory, the bot needs to acquire some.
    // The previous skills suggest `hunt_for_food` or `explore_and_find_wheat_seeds`.
    // Given the urgency, hunting for immediate food (like killing a mob that drops meat) might be faster.
    // For now, if no food is present, we'll try to hunt for it.
    // This part requires a new primitive/skill if not available, but for this task, the focus is on eating if available.
    // Let's assume for now that if no food is found, the higher-level orchestrator will handle food acquisition.
    // For this specific function, we only handle eating *if* food is present.
    // If the task implies acquiring food if none is present, then this function needs to be augmented or a new skill called.
    // Given "Find and eat food urgently", it implies finding it if not in inventory.
    // Let's call hunt_for_food if no food is found.
    // Note: The prompt states "hunger is full (20/20)", so eating won't directly restore health unless it's a special item.
    // However, the task explicitly asks to "Find and eat food urgently".
    // We will prioritize finding *any* food item and eating it, as per the task.

    // Check inventory again, in case a previous action (if any) yielded food.
    const foodInInventory = bot.inventory.items().find(i => i.foodRecovery > 0);
    if (foodInInventory) {
      await bot.equip(foodInInventory, 'hand');
      await bot.consume();
    } else {
      // No food found, so we need to acquire some.
      // The prompt suggests `hunt_for_food`. Let's assume it's a callable skill.
      // Since `hunt_for_food` is listed as a relevant skill, we can call it.
      await huntForFood(bot);
      // After hunting, check again and eat if successful.
      const newlyAcquiredFood = bot.inventory.items().find(i => i.foodRecovery > 0);
      if (newlyAcquiredFood) {
        await bot.equip(newlyAcquiredFood, 'hand');
        await bot.consume();
      }
    }
  }
}