async function craft1WoodenAxe(bot) {
  // Check if we have a crafting table nearby
  let craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });

  // If no crafting table, try to find one in inventory
  if (!craftingTable) {
    const craftingTableInInventory = bot.inventory.items().find(item => item.name === 'crafting_table');
    if (craftingTableInInventory) {
      // Place the crafting table if we have one
      const targetPos = bot.entity.position.offset(1, 0, 0).floored(); // Try to place it nearby
      await placeItem('crafting_table', targetPos.x, targetPos.y, targetPos.z);
      craftingTable = bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      });
    } else {
      // Craft a crafting table if we don't have one and don't have enough planks
      const oakPlanksCount = bot.inventory.items().find(i => i.name === 'oak_planks')?.count || 0;
      if (oakPlanksCount < 4) {
        const oakLogsCount = bot.inventory.items().find(i => i.name === 'oak_log')?.count || 0;
        if (oakLogsCount > 0) {
          await craftItem('oak_planks', 4); // Craft planks from logs
        } else {
          // Need to mine wood first, but not explicitly asked for here. Assume enough logs/planks or fail.
          // For now, if no crafting table and no logs/planks, it will fail.
        }
      }
      // After potentially crafting planks, try to craft the crafting table
      await craftItem('crafting_table', 1);
      // Try to place it again
      const targetPos = bot.entity.position.offset(1, 0, 0).floored();
      await placeItem('crafting_table', targetPos.x, targetPos.y, targetPos.z);
      craftingTable = bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      });
    }
  }

  // Ensure we have enough oak planks
  let oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
  if (!oakPlanks || oakPlanks.count < 3) {
    const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
    if (oakLogs && oakLogs.count > 0) {
      // Craft enough planks from logs
      const planksNeeded = 3 - (oakPlanks?.count || 0);
      await craftItem('oak_planks', planksNeeded);
    } else {
      // If no logs, cannot get planks, cannot craft
      throw new Error('Not enough oak_planks or oak_log to craft wooden_axe');
    }
  }

  // Ensure we have enough sticks
  let sticks = bot.inventory.items().find(item => item.name === 'stick');
  if (!sticks || sticks.count < 2) {
    const planksAvailable = bot.inventory.items().find(item => item.name === 'oak_planks')?.count || 0;
    if (planksAvailable >= 1) {
      // 1 plank makes 4 sticks, we need 2
      // Craft sticks. If we need 2 sticks, craft 4 from 1 plank.
      await craftItem('stick', 4); // Craft 4 sticks from 1 plank
    } else {
      throw new Error('Not enough oak_planks to craft sticks for wooden_axe');
    }
  }

  // Now craft the wooden axe using the crafting table
  if (craftingTable) {
    await craftItem('wooden_axe', 1);
  } else {
    throw new Error('Could not find or place a crafting_table to craft wooden_axe.');
  }
}