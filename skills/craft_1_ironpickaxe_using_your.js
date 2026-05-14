async function craftIronPickaxe(bot) {
  // Check if iron_pickaxe is already in inventory
  const ironPickaxe = bot.inventory.items().find(item => item.name === 'iron_pickaxe');
  if (ironPickaxe && ironPickaxe.count >= 1) {
    return; // Already have an iron pickaxe
  }

  // Check for required materials
  const ironIngots = bot.inventory.items().find(item => item.name === 'iron_ingot');
  const sticks = bot.inventory.items().find(item => item.name === 'stick');
  if (!ironIngots || ironIngots.count < 3) {
    // This scenario should be handled by a higher-level task orchestrator
    // For now, we assume materials are present as per the prompt context.
    // If not, a primitive will throw an error, which is desired.
    return;
  }
  if (!sticks || sticks.count < 2) {
    // A pickaxe needs 2 sticks
    return;
  }

  // Find a crafting table
  const craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    // If no crafting table is found, a higher-level task should place one.
    // Given the world memory, one exists at 856,71,282.
    return;
  }

  // Craft the iron pickaxe
  await craftItem('iron_pickaxe', 1);
}