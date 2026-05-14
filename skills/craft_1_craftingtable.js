async function craft1CraftingTable(bot) {
  // Check if crafting_table is already in inventory
  const craftingTableInInventory = bot.inventory.items().find(item => item.name === 'crafting_table');
  if (craftingTableInInventory) {
    return; // Already have a crafting table
  }

  // Check for oak planks
  let oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
  if (!oakPlanks || oakPlanks.count < 4) {
    // Need to craft oak planks from oak logs
    let oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
    if (!oakLogs || oakLogs.count < 1) {
      // Need to mine oak logs first
      await mineBlock('oak_log', 1);
      oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
    }
    // Craft planks from logs
    if (oakLogs && oakLogs.count > 0) {
      await craftItem('oak_planks', Math.min(oakLogs.count * 4, 4)); // Craft at least 4 planks if possible
    }
  }

  // Check again for oak planks after crafting from logs
  oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
  if (oakPlanks && oakPlanks.count >= 4) {
    await craftItem('crafting_table', 1);
  } else {
    // This case should ideally not be reached if enough logs were gathered.
    // However, if for some reason planks couldn't be crafted, we'd log an error or retry.
    // For now, assume craftItem will throw if requirements aren't met.
  }
}