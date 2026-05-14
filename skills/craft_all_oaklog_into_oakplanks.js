async function craftAllOaklogIntoOakplanks(bot) {
  const oakLogs = bot.inventory.items().find(item => item.name === 'oak_log');
  if (!oakLogs) {
    // No oak_log to craft
    return;
  }

  // Find a crafting table, either in inventory or placed nearby
  let craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  let craftingTablePos = null;
  if (!craftingTable) {
    // Check if a crafting table is already placed nearby
    const nearbyCraftingTable = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
    if (!nearbyCraftingTable) { console.log("Block not found"); return; }
    if (nearbyCraftingTable) {
      craftingTablePos = nearbyCraftingTable.position;
    } else {
      // If no crafting table in inventory or nearby, we cannot proceed.
      // The task implies a crafting_table is available, so this case might indicate a missing prerequisite.
      // For now, assume it's either in inventory or nearby as per task description.
      // If it's truly missing, a prior skill should have crafted one.
      // Given the inventory has one, this branch should not be taken.
    }
  }

  // If crafting table is in inventory, place it if not already placed
  if (craftingTable && !craftingTablePos) {
    // Try to find a suitable position to place the crafting table
    const refBlock = bot.findBlock({
      matching: b => b.name === 'grass_block' || b.name === 'dirt',
      maxDistance: 32
    });
    if (!refBlock) {
      // No suitable block to place on, try current position - 1 in y
      const pos = bot.entity.position.offset(0, -1, 0);
      await placeItem('crafting_table', pos.x, pos.y, pos.z);
      craftingTablePos = pos;
    } else {
      const placePos = refBlock.position.offset(0, 1, 0);
      await placeItem('crafting_table', placePos.x, placePos.y, placePos.z);
      craftingTablePos = placePos;
    }
  }

  // Calculate total planks: 1 oak_log -> 4 oak_planks
  const totalPlanksToCraft = oakLogs.count * 4;

  // Craft all oak_log into oak_planks
  // The craftItem primitive should handle using the crafting table if one is placed
  // or hand crafting if it's a 2x2 recipe. Oak planks are 2x2.
  await craftItem('oak_planks', totalPlanksToCraft);
}