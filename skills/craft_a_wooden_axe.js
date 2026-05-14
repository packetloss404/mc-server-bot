async function craftAWoodenAxe(bot) {
  const craftingTable = bot.inventory.items().find(item => item.name === 'crafting_table');

  // Check if wooden axe is already in inventory
  const woodenAxe = bot.inventory.items().find(item => item.name === 'wooden_axe');
  if (woodenAxe && woodenAxe.count > 0) {
    return; // Already have a wooden axe
  }

  // Check if we have the materials
  const oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');
  const sticks = bot.inventory.items().find(item => item.name === 'stick');
  if (!oakPlanks || oakPlanks.count < 3) {
    // Need more oak planks. First get oak_log, then craft planks.
    // Assuming 'mineBlock' will collect oak_log if available or find it.
    await mineBlock('oak_log', 1); // Get 1 log, which yields 4 planks
    await craftItem('oak_planks', 4); // Craft planks from the log
  }
  if (!sticks || sticks.count < 2) {
    // Need more sticks. Craft from oak_planks.
    await craftItem('stick', 4); // Craft 4 sticks (uses 2 planks)
  }

  // Ensure we have a crafting table
  if (!craftingTable) {
    // Craft a crafting table if none exists
    const planksForTable = bot.inventory.items().find(item => item.name === 'oak_planks');
    if (!planksForTable || planksForTable.count < 4) {
      await mineBlock('oak_log', 1);
      await craftItem('oak_planks', 4);
    }
    await craftItem('crafting_table', 1);
  }

  // If a crafting table is needed, place it
  if (!bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  })) {
    const craftingTableItem = bot.inventory.items().find(item => item.name === 'crafting_table');
    if (craftingTableItem) {
      const refBlock = bot.findBlock({
        matching: b => b.name === 'grass_block' || b.name === 'dirt',
        maxDistance: 32
      });
      if (!refBlock) { console.log("Block not found"); return; }
      if (refBlock) {
        const p = refBlock.position;
        await placeItem('crafting_table', p.x, p.y + 1, p.z);
      } else {
        // Fallback: place near bot if no suitable block found
        const botPos = bot.entity.position;
        await placeItem('crafting_table', Math.floor(botPos.x), Math.floor(botPos.y) - 1, Math.floor(botPos.z));
      }
    } else {
      // Should not happen if craftItem('crafting_table') was successful
      throw new Error('Failed to obtain crafting table item.');
    }
  }

  // Craft the wooden axe
  await craftItem('wooden_axe', 1);
}