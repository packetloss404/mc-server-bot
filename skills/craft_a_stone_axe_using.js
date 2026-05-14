async function craftStoneAxe(bot) {
  // Check if we have enough cobblestone (3) and sticks (2)
  const cobblestoneCount = bot.inventory.items().find(item => item.name === 'cobblestone')?.count || 0;
  const stickCount = bot.inventory.items().find(item => item.name === 'stick')?.count || 0;
  if (cobblestoneCount < 3) {
    // Mine more cobblestone if needed
    await mineBlock('cobblestone', 3 - cobblestoneCount);
  }
  if (stickCount < 2) {
    // Craft more sticks if needed
    // First, check for oak planks to make sticks
    const oakPlanksCount = bot.inventory.items().find(item => item.name === 'oak_planks')?.count || 0;
    if (oakPlanksCount === 0) {
      // If no planks, get some wood first
      const oakLogCount = bot.inventory.items().find(item => item.name === 'oak_log')?.count || 0;
      if (oakLogCount === 0) {
        await mineBlock('oak_log', 1); // Get at least one log to make planks
      }
      // Craft logs into planks (1 log makes 4 planks)
      await craftItem('oak_planks', 4);
    }
    // Craft sticks (2 planks make 4 sticks)
    await craftItem('stick', Math.ceil((2 - stickCount) / 4) * 4); // Craft enough sticks in batches of 4
  }

  // Craft the stone axe
  await craftItem('stone_axe', 1);
}