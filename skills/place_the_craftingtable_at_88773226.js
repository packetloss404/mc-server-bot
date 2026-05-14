async function placeCraftingTableForSecuringArea(bot) {
  const targetX = 887;
  const targetY = 73;
  const targetZ = 226;
  let craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  if (!craftingTable) {
    // Crafting table not in inventory, craft one
    // A crafting table requires 4 planks. Any type will do.
    const planks = bot.inventory.items().find(item => item.name.includes('_planks'));
    if (!planks || planks.count < 4) {
      // Need to get wood first to make planks
      // Assuming oak_log is a common source, explore for it
      let oakLog = bot.inventory.items().find(item => item.name === 'oak_log');
      if (!oakLog || oakLog.count < 1) {
        await exploreUntil('north', 60,
        // explore for 60 seconds
        () => {
          const logBlock = bot.findBlock({
            matching: b => b.name.includes('_log'),
            maxDistance: 32
          });
          return logBlock ? logBlock.position : null;
        });
        oakLog = bot.findBlock({
          matching: b => b.name.includes('_log'),
          maxDistance: 32
        });
        if (oakLog) {
          await mineBlock(oakLog.name, 1);
        } else {
          throw new Error("Could not find any logs to craft planks for a crafting table.");
        }
      }
      // Now craft planks
      await craftItem('oak_planks', 4); // Craft 4 planks from one log
    }
    await craftItem('crafting_table', 1);
    craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  }
  if (craftingTable) {
    await placeItem('crafting_table', targetX, targetY, targetZ);
  } else {
    throw new Error("Failed to obtain a crafting table.");
  }
}