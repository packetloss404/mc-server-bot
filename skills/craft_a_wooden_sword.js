async function craftAWoodenSword(bot) {
  const sword = bot.inventory.items().find(item => item.name === 'wooden_sword');
  if (sword) {
    return; // Already have a wooden sword
  }
  const sticks = bot.inventory.items().find(item => item.name === 'stick');
  const oakPlanks = bot.inventory.items().find(item => item.name === 'oak_planks');

  // Check if materials are sufficient
  if (!sticks || sticks.count < 1) {
    // Need to craft sticks if not enough
    const logs = bot.inventory.items().find(item => item.name.includes('_log'));
    if (!logs || logs.count < 1) {
      // If no logs, mine some. Assuming any log type is fine.
      await mineBlock('oak_log', 1);
    }
    await craftItem('oak_planks', 4); // Craft planks from log
    await craftItem('stick', 4); // Craft sticks from planks
  }
  if (!oakPlanks || oakPlanks.count < 2) {
    // Need to craft oak planks if not enough
    const logs = bot.inventory.items().find(item => item.name.includes('_log'));
    if (!logs || logs.count < 1) {
      // If no logs, mine some. Assuming any log type is fine.
      await mineBlock('oak_log', 1);
    }
    await craftItem('oak_planks', 4); // Craft planks from log
  }

  // Ensure crafting table is present and placed if needed
  let craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    const tableInInventory = bot.inventory.items().find(item => item.name === 'crafting_table');
    if (!tableInInventory) {
      await craftItem('crafting_table', 1);
    }
    // Find a suitable place to place the crafting table
    const refBlock = bot.blockAt(bot.entity.position.offset(0, -1, 0)); // Block below bot
    if (refBlock && refBlock.name !== 'air') {
      const p = bot.entity.position.offset(1, 0, 0); // Try placing one block away
      await placeItem('crafting_table', p.x, p.y, p.z);
      craftingTable = bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      });
    } else {
      // If no block below, try placing at bot's feet.
      const p = bot.entity.position;
      await placeItem('crafting_table', p.x, p.y, p.z);
      craftingTable = bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      });
    }
  }

  // Craft the wooden sword
  await craftItem('wooden_sword', 1);
}