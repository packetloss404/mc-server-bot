async function craftAWoodenPickaxe(bot) {
  // Check if wooden_pickaxe is already in inventory
  if (bot.inventory.items().find(item => item.name === 'wooden_pickaxe')) {
    return; // Already have it
  }

  // Ensure we have a crafting table, either in inventory or placed nearby
  let craftingTableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTableBlock) {
    // Check if we have a crafting table in inventory
    const craftingTableInInventory = bot.inventory.items().find(item => item.name === 'crafting_table');
    if (!craftingTableInInventory) {
      // If no crafting table is found or in inventory, craft one first
      const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
      if (!oakLogs || oakLogs.count < 1) {
        // Need at least 1 oak log to make 4 planks, then 1 crafting table
        await mineBlock('oak_log', 1);
      }
      // Craft 4 oak planks from 1 oak log (if not enough)
      const oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
      if (!oakPlanks || oakPlanks.count < 4) {
        // Need 4 planks for crafting table
        const planksToCraft = 4 - (oakPlanks ? oakPlanks.count : 0);
        if (planksToCraft > 0) {
          await craftItem('oak_planks', planksToCraft); // This will convert logs to planks
        }
      }
      // Craft a crafting table
      await craftItem('crafting_table', 1);
    }

    // Place the crafting table if we have one in inventory but none nearby
    if (!craftingTableBlock) {
      const targetPos = bot.entity.position.offset(1, 0, 0); // Place it next to the bot
      await placeItem('crafting_table', targetPos.x, targetPos.y, targetPos.z);
      craftingTableBlock = bot.findBlock({
        // Re-find the placed crafting table
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      });
      if (!craftingTableBlock) {
        throw new Error('Failed to place or find crafting table.');
      }
    }
  }

  // Ensure we have enough oak planks (3 needed for pickaxe)
  const oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
  if (!oakPlanks || oakPlanks.count < 3) {
    const neededPlanks = 3 - (oakPlanks ? oakPlanks.count : 0);
    // Try to get more logs to convert to planks
    const logs = bot.inventory.items().find(item => item.name === 'oak_log');
    if (!logs || logs.count < Math.ceil(neededPlanks / 4)) {
      // 1 log makes 4 planks
      await mineBlock('oak_log', Math.ceil(neededPlanks / 4) - (logs ? logs.count : 0));
    }
    // Craft planks
    await craftItem('oak_planks', neededPlanks);
  }

  // Ensure we have enough sticks (2 needed for pickaxe)
  const sticks = bot.inventory.items().find(item => item.name === 'stick');
  if (!sticks || sticks.count < 2) {
    const neededSticks = 2 - (sticks ? sticks.count : 0);
    // Craft sticks from planks
    await craftItem('stick', neededSticks);
  }

  // Now craft the wooden pickaxe using the crafting table
  await craftItem('wooden_pickaxe', 1);
}