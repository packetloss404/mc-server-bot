async function craft20OakPlanksUsingYour(bot) {
  // Ensure we have a crafting table placed or in inventory
  let craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');
  if (!craftingTable) {
    const craftingTableBlock = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
    if (!craftingTableBlock) {
      // If no crafting table is found, the prerequisite to craft one would be to have oak_planks.
      // But the task implies we already have a crafting table or can easily get one.
      // Given the inventory, we have a crafting_table, so this branch should not be hit.
      // If it were, we'd need to collect wood, craft planks, then craft a crafting table.
      // For this specific task, we assume the crafting_table is available (either in inventory or placed).
      // Since it's in inventory, we don't need to place it unless specifically required by craftItem.
      // craftItem handles placing a temporary one if needed, but it's better to have one placed.
      // For now, let's assume craftItem can handle it.
    }
  }

  // Craft 20 oak_planks. craftItem will handle using the crafting table if needed.
  await craftItem('oak_planks', 20);
}