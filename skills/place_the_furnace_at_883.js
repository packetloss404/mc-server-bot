async function placeFurnaceAtLocation(bot) {
  const targetX = 883;
  const targetY = 61;
  const targetZ = 204;

  // Check if bot has a furnace
  let furnaceItem = bot.inventory.items().find(item => item.name === 'furnace');
  if (!furnaceItem) {
    // If not, try to craft one
    const cobblestoneCount = bot.inventory.items().find(item => item.name === 'cobblestone')?.count || 0;
    if (cobblestoneCount < 8) {
      // If not enough cobblestone, try to mine some.
      // For this task, we assume the bot has enough resources or can acquire them.
      // If a more complex crafting chain is needed, it would be a separate task.
      // For now, if cobblestone is missing, we'll assume it's a blocker.
      // In a real scenario, we'd mine cobblestone first.
      throw new Error('Not enough cobblestone to craft a furnace. Need 8, have ' + cobblestoneCount);
    }
    await craftItem('furnace', 1);
    furnaceItem = bot.inventory.items().find(item => item.name === 'furnace');
    if (!furnaceItem) {
      throw new Error('Failed to craft furnace.');
    }
  }

  // Move to the target location
  await moveTo(targetX, targetY, targetZ, 1, 30);

  // Place the furnace
  await placeItem('furnace', targetX, targetY, targetZ);
}