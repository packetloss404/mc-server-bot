async function craft4TorchesUsing1(bot) {
  const craftingTableName = 'crafting_table';
  const coalCount = 1;
  const stickCount = 1;

  // 1. Check for crafting table in inventory or nearby
  let craftingTable = bot.inventory.items().find(item => item.name === craftingTableName);
  let craftingTableBlock = bot.findBlock({
    matching: b => b.name === craftingTableName,
    maxDistance: 32
  });
  if (!craftingTableBlock) {
    // If no crafting table is placed, try to place one from inventory
    if (!craftingTable) {
      // Need to craft a crafting table first if not in inventory
      // This task specifically says "at your crafting_table", implying one might already exist or be placeable.
      // However, the blocker "Could not find a suitable location to place the crafting table" suggests we need to place it.
      // To craft a crafting table, we need 4 oak planks.
      // For simplicity, let's assume we either have one or need to make one from planks.
      // If we don't have a crafting table, we need to get wood, make planks, then make a crafting table.
      // This is a sub-task not explicitly in the prompt, but implied by the blocker.
      const oakLogs = bot.inventory.items().find(i => i.name === 'oak_log');
      if (!oakLogs || oakLogs.count < 1) {
        await mineBlock('oak_log', 1);
      }
      await craftItem('oak_planks', 4);
      await craftItem(craftingTableName, 1);
      craftingTable = bot.inventory.items().find(item => item.name === craftingTableName);
    }

    // Try to place the crafting table
    if (craftingTable) {
      // Find a suitable position to place the crafting table
      // Look for a block below the bot's feet or nearby
      const refBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0)); // Block directly below bot
      if (refBlock && refBlock.name !== 'air' && refBlock.name !== 'water') {
        await placeItem(craftingTableName, refBlock.position.x, refBlock.position.y + 1, refBlock.position.z);
        craftingTableBlock = bot.findBlock({
          matching: b => b.name === craftingTableName,
          maxDistance: 32
        });
      } else {
        // If block below is not suitable, try a few common positions around the bot
        const botPos = bot.entity.position;
        const potentialPlacePositions = [botPos.offset(1, 0, 0), botPos.offset(-1, 0, 0), botPos.offset(0, 0, 1), botPos.offset(0, 0, -1)];
        let placed = false;
        for (const pos of potentialPlacePositions) {
          const blockAtPos = bot.blockAt(pos);
          const blockBelow = bot.blockAt(pos.offset(0, -1, 0));
          if (blockAtPos && blockAtPos.name === 'air' && blockBelow && blockBelow.type !== 0) {
            // type 0 is air
            await placeItem(craftingTableName, pos.x, pos.y, pos.z);
            craftingTableBlock = bot.findBlock({
              matching: b => b.name === craftingTableName,
              maxDistance: 32
            });
            if (craftingTableBlock) {
              placed = true;
              break;
            }
          }
        }
        if (!placed) {
          // Fallback if no easy spot, try exploring for a placeable spot.
          // This is a more complex scenario, for now, assume simple placement attempts are sufficient.
          // If still no place, the task might fail with the original blocker.
          throw new Error("Could not find a suitable location to place the crafting table.");
        }
      }
    }
  }

  // 2. Collect materials if needed
  let currentCoal = bot.inventory.items().find(i => i.name === 'coal');
  if (!currentCoal || currentCoal.count < coalCount) {
    await mineBlock('coal_ore', coalCount - (currentCoal ? currentCoal.count : 0));
  }
  let currentSticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!currentSticks || currentSticks.count < stickCount) {
    // To craft sticks, we need planks. To craft planks, we need wood.
    // Let's get wood, then craft planks, then craft sticks.
    const oakLogs = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!oakLogs || oakLogs.count < Math.ceil(stickCount / 4 / 4)) {
      // 1 log -> 4 planks -> 4 sticks (1 plank -> 4 sticks)
      await mineBlock('oak_log', 1);
    }
    await craftItem('oak_planks', 1); // Craft 1 plank to get 4 sticks
    await craftItem('stick', stickCount - (currentSticks ? currentSticks.count : 0));
  }

  // 3. Craft torches
  await craftItem('torch', 4);
}