async function craftWoodenPickaxe(bot) {
  // Check if a crafting table is in inventory
  let craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');

  // If not in inventory, craft one
  if (!craftingTable) {
    // Check if we have enough oak planks to craft a crafting table (4 oak planks)
    const oakPlanksCount = bot.inventory.items().find(item => item.name === 'oak_planks')?.count || 0;
    if (oakPlanksCount < 4) {
      // If not enough oak planks, craft them from oak logs if available
      const oakLogsCount = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
      if (oakLogsCount > 0) {
        await craftItem('oak_planks', oakLogsCount * 4); // Craft planks from all logs
      } else {
        // If no oak logs, we can't craft a crafting table
        throw new Error('Not enough oak logs or planks to craft a crafting table.');
      }
    }
    await craftItem('crafting_table', 1);
    craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  }

  // If there's no crafting table nearby, place the one from inventory
  let nearbyCraftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!nearbyCraftingTable) {
    if (!craftingTable) {
      throw new Error('No crafting table in inventory and none nearby to place.');
    }
    // Find a suitable position to place the crafting table
    // For simplicity, try to place it at the current bot position's feet level or slightly offset
    const placePos = bot.entity.position.offset(0, -1, 0).floored(); // Try to place at feet level
    await placeItem('crafting_table', placePos.x, placePos.y, placePos.z);
    nearbyCraftingTable = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }

  // Ensure we have enough materials for a wooden pickaxe (3 oak planks, 2 sticks)
  const oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
  if (!oakPlanks || oakPlanks.count < 3) {
    // Need more oak planks. Craft from oak logs if available.
    const oakLog = bot.inventory.items().find(item => item.name === 'oak_log');
    if (oakLog && oakLog.count > 0) {
      const neededPlanks = 3 - (oakPlanks?.count || 0);
      await craftItem('oak_planks', neededPlanks);
    } else {
      throw new Error('Not enough oak planks or oak logs to craft a wooden pickaxe.');
    }
  }
  const sticks = bot.inventory.items().find(item => item.name === 'stick');
  if (!sticks || sticks.count < 2) {
    // Need more sticks. Craft from oak planks if available.
    const planksForSticks = bot.inventory.items().find(item => item.name === 'oak_planks');
    if (planksForSticks && planksForSticks.count >= 1) {
      // 1 plank makes 4 sticks, enough for 2 sticks
      await craftItem('stick', 4); // Craft 4 sticks from 1 plank
    } else {
      throw new Error('Not enough sticks or oak planks to craft a wooden pickaxe.');
    }
  }

  // Craft the wooden pickaxe using the crafting table
  await craftItem('wooden_pickaxe', 1);
}