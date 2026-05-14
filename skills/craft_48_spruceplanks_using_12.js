async function craft48SprucePlanksUsing12(bot) {
  const spruceLogCount = bot.inventory.items().find(i => i.name === 'spruce_log')?.count || 0;
  if (spruceLogCount < 12) {
    // This scenario should ideally not happen if the task specifies "using 12 spruce_log"
    // but it's a good check. For this task, we assume 12 spruce_log are present.
    throw new Error("Not enough spruce_log to craft 48 spruce_planks.");
  }

  // Check for crafting table in inventory
  let craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  if (!craftingTable) {
    // This should not happen based on current inventory, but for robustness:
    throw new Error("Crafting table not found in inventory.");
  }

  // Find a suitable position to place the crafting table
  const refBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0)); // Block under bot
  let placePosition = refBlock.position.offset(1, 0, 0); // Try one block away from current position

  // Check if there's already a crafting table nearby
  let existingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!existingTable) {
    // No crafting table found, place it
    await placeItem('crafting_table', placePosition.x, placePosition.y, placePosition.z);
    existingTable = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    }); // Re-find after placing
  }
  if (!existingTable) {
    throw new Error("Could not find or place a crafting table.");
  }

  // Move to the crafting table if not already close
  await moveTo(existingTable.position.x, existingTable.position.y + 1, existingTable.position.z, 2, 10);

  // Craft 48 spruce_planks. 1 spruce_log makes 4 spruce_planks. So 12 logs * 4 planks/log = 48 planks.
  await craftItem('spruce_planks', 48);
}