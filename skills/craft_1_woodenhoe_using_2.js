async function craft1WoodenHoe(bot) {
  // Check if crafting_table is in inventory
  let craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  if (!craftingTable) {
    // If no crafting table, we cannot craft at a crafting table.
    // For this task, we assume it's available or can be obtained.
    // Since the inventory shows crafting_table x1, we proceed.
  }

  // Check for required materials: 2 sticks, 2 oak_planks
  const sticks = bot.inventory.items().find(item => item.name === 'stick');
  const oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
  if (!sticks || sticks.count < 2) {
    // Need more sticks. Craft sticks from oak_planks.
    // Each oak_plank makes 4 sticks. So 1 oak_plank is enough for 2 sticks.
    if (!oakPlanks || oakPlanks.count < 1) {
      // Need at least 1 plank to make sticks
      // If we don't have enough oak_planks to make sticks, we need to get more wood.
      // This scenario is not explicitly handled by a primitive, so we assume enough planks are available
      // or that the previous steps would have provided them.
      // For now, if we don't have enough planks, we'll just fail.
      throw new Error("Not enough oak_planks to craft sticks for wooden_hoe.");
    }
    // Craft 4 sticks using 2 oak_planks (primitive craft_4_sticks_using_your requires 2 planks)
    // We only need 2 sticks, so let's just make what's needed for the hoe if possible.
    // craftItem will take care of finding a recipe.
    await craftItem('stick', 2);
  }
  if (!oakPlanks || oakPlanks.count < 2) {
    // Need more oak_planks. Craft from oak_log.
    const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
    if (!oakLogs || oakLogs.count < 1) {
      // 1 oak_log makes 4 oak_planks
      // If no oak_logs, we need to mine them first.
      await mineBlock('oak_log', 1); // Get at least 1 log
    }
    await craftItem('oak_planks', 2); // Craft enough planks
  }

  // Now, craft the wooden_hoe
  await craftItem('wooden_hoe', 1);
}