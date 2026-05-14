async function craftStonePickaxe(bot) {
  // Ensure we have a crafting table
  let craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  if (!craftingTable) {
    // If no crafting table, we need to craft one. This implies having wood.
    // For simplicity, assuming the task ensures a crafting table is available or can be easily made.
    // Given the current inventory, a crafting table is present.
    // If not, we'd need to get wood -> planks -> crafting table.
    // This task specifically focuses on the pickaxe, so we'll assume the table is handled.
  }

  // Ensure we have enough cobblestone (3)
  let cobblestoneCount = bot.inventory.items().find(item => item.name === 'cobblestone')?.count || 0;
  if (cobblestoneCount < 3) {
    // If not enough, mine more cobblestone.
    await mineBlock('cobblestone', 3 - cobblestoneCount);
  }

  // Ensure we have enough sticks (2)
  let stickCount = bot.inventory.items().find(item => item.name === 'stick')?.count || 0;
  if (stickCount < 2) {
    // If not enough, craft sticks from wood planks.
    // First, check for planks.
    let oakPlanksCount = bot.inventory.items().find(item => item.name === 'oak_planks')?.count || 0;
    if (oakPlanksCount < 1 && stickCount < 2) {
      // Need at least 1 plank for 4 sticks, or more if no sticks
      // If no planks, get some wood and craft planks.
      let oakLogCount = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
      if (oakLogCount === 0) {
        await mineBlock('oak_log', 1); // Get at least one log
      }
      await craftItem('oak_planks', 1); // Craft planks from log
    }
    await craftItem('stick', 2 - stickCount); // Craft sticks
  }

  // Place crafting table if not already placed or if we need to use it
  let craftingTableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTableBlock) {
    // Find a suitable position to place the crafting table
    const refBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0)); // Block below bot
    const placePos = refBlock.position.offset(0, 1, 0); // One block above the block below bot
    await placeItem('crafting_table', placePos.x, placePos.y, placePos.z);
    craftingTableBlock = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }

  // Craft the stone pickaxe
  if (craftingTableBlock) {
    await craftItem('stone_pickaxe', 1);
  } else {
    // This case should ideally not be reached if previous steps were successful
    throw new Error('Could not find or place a crafting table to craft the stone pickaxe.');
  }
}