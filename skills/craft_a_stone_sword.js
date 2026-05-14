async function craftAStoneSword(bot) {
  const stoneSword = bot.inventory.items().find(item => item.name === 'stone_sword');
  if (stoneSword && stoneSword.count >= 1) {
    return; // Already have a stone sword
  }

  // A stone sword requires 2 cobblestone and 1 stick.
  let cobblestoneCount = bot.inventory.items().find(item => item.name === 'cobblestone')?.count || 0;
  let stickCount = bot.inventory.items().find(item => item.name === 'stick')?.count || 0;

  // Collect cobblestone if needed
  if (cobblestoneCount < 2) {
    await mineBlock('cobblestone', 2 - cobblestoneCount);
    cobblestoneCount = bot.inventory.items().find(item => item.name === 'cobblestone')?.count || 0; // Update count
  }

  // Collect sticks if needed
  if (stickCount < 1) {
    // Craft sticks from oak planks if needed, or get wood
    let oakPlanksCount = bot.inventory.items().find(item => item.name === 'oak_planks')?.count || 0;
    if (oakPlanksCount < 1) {
      // Need at least 1 plank to make 4 sticks
      // If no planks, get wood first
      const oakLog = bot.inventory.items().find(item => item.name === 'oak_log');
      if (!oakLog || oakLog.count < 1) {
        await mineBlock('oak_log', 1); // Get 1 oak log
      }
      await craftItem('oak_planks', 1); // Craft 4 oak planks from 1 oak log
      oakPlanksCount = bot.inventory.items().find(item => item.name === 'oak_planks')?.count || 0;
    }
    // Now we should have at least 1 oak plank, craft sticks
    if (oakPlanksCount >= 1) {
      // 1 plank makes 4 sticks, we only need 1 stick for the sword
      await craftItem('stick', 1); // Craft 1 stick (will actually craft 4)
      stickCount = bot.inventory.items().find(item => item.name === 'stick')?.count || 0; // Update count
    }
  }

  // Check if we have enough materials after collecting
  if (cobblestoneCount >= 2 && stickCount >= 1) {
    await craftItem('stone_sword', 1);
  } else {
    // This case should ideally not be reached if collection steps are robust
    throw new Error('Failed to gather sufficient materials for stone_sword.');
  }
}