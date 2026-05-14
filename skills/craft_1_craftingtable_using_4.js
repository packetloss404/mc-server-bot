async function craftCraftingTableUsingOakPlanks(bot) {
  // Check if we have enough oak_planks
  let oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
  if (!oakPlanks || oakPlanks.count < 4) {
    // If not, try to get oak_planks. First, check for oak_logs.
    let oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
    if (oakLogs && oakLogs.count >= 1) {
      // 1 oak_log makes 4 oak_planks
      // Craft oak_planks from oak_logs
      await craftItem('oak_planks', 4);
      oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
    } else {
      // If no logs, mine some oak_logs
      await mineBlock('oak_log', 1);
      // After mining, craft planks from the newly acquired log
      await craftItem('oak_planks', 4);
      oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
    }
  }

  // Now that we have 4 oak_planks, craft the crafting_table
  if (oakPlanks && oakPlanks.count >= 4) {
    await craftItem('crafting_table', 1);
  } else {
    throw new Error('Failed to acquire 4 oak_planks to craft a crafting_table.');
  }
}