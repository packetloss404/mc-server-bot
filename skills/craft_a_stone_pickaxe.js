async function craftStonePickaxe(bot) {
  // Check if stone pickaxe is already in inventory
  const stonePickaxe = bot.inventory.items().find(item => item.name === 'stone_pickaxe');
  if (stonePickaxe) {
    return; // Already have a stone pickaxe, task complete
  }

  // Ensure we have a crafting table nearby
  let craftingTable = bot.findBlock({
    matching: block => block.name === 'crafting_table',
    maxDistance: 32
  });

  // If no crafting table, try to place one if we have it
  if (!craftingTable) {
    const craftingTableItem = bot.inventory.items().find(item => item.name === 'crafting_table');
    if (craftingTableItem) {
      // Find a suitable position to place the crafting table
      // Try to place it near the bot, on a solid block
      const botPos = bot.entity.position.offset(0, -1, 0); // Block below bot
      let placePos = null;
      for (let x = -1; x <= 1; x++) {
        for (let z = -1; z <= 1; z++) {
          const checkPos = botPos.offset(x, 1, z); // One block above current
          const blockAtCheckPos = bot.blockAt(checkPos);
          if (blockAtCheckPos && blockAtCheckPos.diggable && !blockAtCheckPos.liquid) {
            // Ensure it's not air/liquid
            const blockAbove = bot.blockAt(checkPos.offset(0, 1, 0));
            if (blockAbove && blockAbove.name === 'air') {
              // Ensure space above for placement
              placePos = checkPos;
              break;
            }
          }
        }
        if (placePos) break;
      }
      if (placePos) {
        await placeItem('crafting_table', placePos.x, placePos.y, placePos.z);
        craftingTable = bot.findBlock({
          matching: block => block.name === 'crafting_table',
          maxDistance: 32
        }); // Re-find the placed crafting table
      } else {
        // Cannot place crafting table, might need to craft one first, but this skill assumes it's available or can be placed.
        // For now, if no crafting table and cannot place, we assume a prerequisite is missing.
        throw new Error('Cannot find or place a crafting table to craft stone pickaxe.');
      }
    } else {
      // No crafting table in inventory and none nearby. This skill does not cover crafting a crafting table.
      throw new Error('No crafting table available to craft stone pickaxe. Crafting table needed.');
    }
  }

  // Ensure materials are in inventory (cobblestone: 3, stick: 2)
  const cobblestoneCount = bot.inventory.items().find(item => item.name === 'cobblestone')?.count || 0;
  const stickCount = bot.inventory.items().find(item => item.name === 'stick')?.count || 0;
  if (cobblestoneCount < 3 || stickCount < 2) {
    throw new Error('Not enough materials to craft a stone pickaxe. Requires 3 cobblestone and 2 sticks.');
  }

  // Craft the stone pickaxe using the crafting table
  await craftItem('stone_pickaxe', 1);
}