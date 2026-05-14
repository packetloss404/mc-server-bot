async function craft1CraftingTable(bot) {
  // Check if crafting table is already in inventory
  const craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  if (craftingTable) {
    // Already have a crafting table, task complete
    return;
  }

  // Check for required materials: 4 planks
  let oakPlanksCount = bot.inventory.items().find(item => item.name === 'oak_planks')?.count || 0;
  let oakLogCount = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;

  // Need 4 planks for one crafting table
  if (oakPlanksCount < 4) {
    // If not enough planks, check for logs to convert
    // 1 log makes 4 planks
    if (oakLogCount === 0) {
      // Need to mine some oak logs
      await mineBlock('oak_log', 1); // Mine at least one log
      oakLogCount = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
    }

    // Convert logs to planks if needed
    if (oakLogCount > 0 && oakPlanksCount < 4) {
      const planksToCraft = 4 - oakPlanksCount;
      const logsNeeded = Math.ceil(planksToCraft / 4); // 1 log makes 4 planks
      if (oakLogCount < logsNeeded) {
        await mineBlock('oak_log', logsNeeded - oakLogCount);
      }
      // Craft planks from logs
      await craftItem('oak_planks', planksToCraft);
    }
  }

  // Now craft the crafting table
  await craftItem('crafting_table', 1);
}