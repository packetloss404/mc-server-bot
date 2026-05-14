async function craft4OakPlanks(bot) {
  const oakPlanksInInventory = bot.inventory.items().find(item => item.name === 'oak_planks');
  if (oakPlanksInInventory && oakPlanksInInventory.count >= 4) {
    return; // Already have enough oak planks
  }
  const oakLogsInInventory = bot.inventory.items().find(item => item.name === 'oak_log');
  if (!oakLogsInInventory || oakLogsInInventory.count < 1) {
    // Need at least 1 oak log to craft 4 oak planks
    throw new Error('Not enough oak_log in inventory to craft 4 oak_planks.');
  }

  // Craft 4 oak planks (which consumes 1 oak log)
  await craftItem('oak_planks', 4);
}