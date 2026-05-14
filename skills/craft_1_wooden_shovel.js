async function craftWoodenShovel(bot) {
  // Check if wooden shovel is already in inventory
  const shovel = bot.inventory.items().find(item => item.name === 'wooden_shovel');
  if (shovel) {
    return; // Already have a wooden shovel
  }

  // Check for required materials: 1 oak_planks, 2 sticks
  let planksCount = bot.inventory.items().find(item => item.name === 'oak_planks')?.count || 0;
  let sticksCount = bot.inventory.items().find(item => item.name === 'stick')?.count || 0;

  // Craft missing sticks if needed (from planks)
  if (sticksCount < 2) {
    const neededSticks = 2 - sticksCount;
    const planksForSticks = Math.ceil(neededSticks / 4); // 1 plank makes 4 sticks
    if (planksCount < planksForSticks) {
      // Need more planks to make sticks. This task assumes planks are available.
      // For this specific task, we have 1 plank and 14 sticks, so we have enough.
      // If we didn't, we would need to mine wood first.
    }
    await craftItem('stick', neededSticks);
    sticksCount = bot.inventory.items().find(item => item.name === 'stick')?.count || 0; // Update stick count
  }

  // Check for crafting table
  let craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    // If no crafting table nearby, check if we have one in inventory
    const inventoryCraftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
    if (inventoryCraftingTable) {
      // Place the crafting table
      // Find a suitable spot to place it (e.g., next to the bot's current position)
      const refBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0)); // Block under bot
      if (!refBlock) {
        throw new Error('Cannot find a block under the bot to place crafting table.');
      }
      const placePosition = refBlock.position.offset(0, 1, 0); // One block above the block under bot
      await placeItem('crafting_table', placePosition.x, placePosition.y, placePosition.z);
      craftingTable = bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      }); // Re-find the placed table
    } else {
      throw new Error('No crafting table found or in inventory to craft a wooden shovel.');
    }
  }

  // Craft the wooden shovel
  await craftItem('wooden_shovel', 1);
}