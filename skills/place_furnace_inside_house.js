async function placeFurnaceInsideHouse(bot) {
  // Check if we have a furnace in inventory
  let furnaceItem = bot.inventory.items().find(i => i.name === 'furnace');
  if (!furnaceItem) {
    // Need to craft a furnace - requires 8 cobblestone
    const cobblestoneItem = bot.inventory.items().find(i => i.name === 'cobblestone');
    let cobblestoneCount = cobblestoneItem ? cobblestoneItem.count : 0;
    if (cobblestoneCount < 8) {
      await mineBlock('cobblestone', 8 - cobblestoneCount);
    }
    await craftItem('furnace', 1);
  }

  // Use the known crafting table location as reference for the house
  // The crafting table is at 881, 73, 223, so place furnace nearby
  const targetPos = {
    x: 882,
    y: 74,
    z: 223
  };

  // Move to the target position with a range of 3 blocks
  await moveTo(targetPos.x, targetPos.y, targetPos.z, 3, 30);

  // Place the furnace at the target location
  await placeItem('furnace', targetPos.x, targetPos.y, targetPos.z);
}