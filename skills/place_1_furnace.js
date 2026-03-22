async function placeFurnace(bot) {
  // Check if furnace is already in inventory
  const furnaceItem = bot.inventory.items().find(i => i.name === 'furnace');
  if (!furnaceItem) {
    // Need to craft a furnace first
    await craftItem('furnace', 1);
  }

  // Place the furnace
  await placeItem('furnace', bot.entity.position.x, bot.entity.position.y, bot.entity.position.z + 1);
}