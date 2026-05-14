async function craftAWoodenHoe(bot) {
  // Check if wooden_hoe is already in inventory
  const woodenHoe = bot.inventory.items().find(item => item.name === 'wooden_hoe');
  if (woodenHoe) {
    return; // Already have a wooden hoe, task complete
  }

  // Check for required materials: 2 sticks, 2 oak_planks
  const sticks = bot.inventory.items().find(item => item.name === 'stick');
  const oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
  if (!sticks || sticks.count < 2) {
    // If not enough sticks, craft them. Each oak_log yields 4 planks, then 2 planks yield 4 sticks.
    // Need at least 1 oak_log to get enough sticks if starting from scratch.
    const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
    if (!oakLogs || oakLogs.count < 1) {
      await mineBlock('oak_log', 1);
    }
    await craftItem('oak_planks', 4); // Craft 4 planks from 1 log
    await craftItem('stick', 4); // Craft 4 sticks from 2 planks
  }
  if (!oakPlanks || oakPlanks.count < 2) {
    // If not enough planks, craft them. Each oak_log yields 4 planks.
    const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
    if (!oakLogs || oakLogs.count < 1) {
      await mineBlock('oak_log', 1);
    }
    await craftItem('oak_planks', 4); // Craft 4 planks from 1 log (should be enough for hoe)
  }

  // Ensure a crafting table is available or place one
  let craftingTable = bot.findBlock({
    matching: block => block.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    const tableInInventory = bot.inventory.items().find(item => item.name === 'crafting_table');
    if (!tableInInventory) {
      // Craft a crafting table if not in inventory
      const wood = bot.inventory.items().find(item => item.name.includes('_log'));
      if (!wood || wood.count < 1) {
        await mineBlock('oak_log', 1); // Mine 1 log to make planks for crafting table
      }
      const planks = bot.inventory.items().find(item => item.name === 'oak_planks');
      if (!planks || planks.count < 4) {
        await craftItem('oak_planks', 4); // Craft 4 planks for crafting table
      }
      await craftItem('crafting_table', 1);
    }
    // Place the crafting table
    const refBlock = bot.findBlock({
      matching: block => block.name === 'grass_block' || block.name === 'dirt' || block.name === 'stone',
      maxDistance: 32
    });
    if (!refBlock) { console.log("Block not found"); return; }
    if (refBlock) {
      const p = refBlock.position;
      await placeItem('crafting_table', p.x, p.y + 1, p.z);
      craftingTable = bot.findBlock({
        matching: block => block.name === 'crafting_table',
        maxDistance: 32
      }); // Re-find the placed table
    } else {
      throw new Error('Could not find a suitable block to place the crafting table.');
    }
  }

  // Craft the wooden hoe
  await craftItem('wooden_hoe', 1);
}