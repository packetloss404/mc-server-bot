async function placeFurnaceAtWatchtower(bot) {
  // Check if we have a furnace in inventory
  const furnaceItem = bot.inventory.items().find(i => i.name === 'furnace');
  if (!furnaceItem) {
    // Need to craft a furnace - requires 8 cobblestone
    const cobblestoneItem = bot.inventory.items().find(i => i.name === 'cobblestone');
    const cobblestoneCount = cobblestoneItem ? cobblestoneItem.count : 0;
    if (cobblestoneCount < 8) {
      // Mine cobblestone
      await mineBlock('cobblestone', 8 - cobblestoneCount);
    }

    // Craft the furnace
    await craftItem('furnace', 1);
  }

  // Move to the target position (857, 65, 254)
  await moveTo(857, 65, 254, 1, 10);

  // Place the furnace at the target position
  await placeItem('furnace', 857, 65, 254);
}