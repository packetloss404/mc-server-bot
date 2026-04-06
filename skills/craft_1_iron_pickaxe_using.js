async function craftIronPickaxeAtTable(bot) {
  const tablePos = {
    x: 952,
    y: 56,
    z: 344
  };

  // Move to the crafting table first
  await moveTo(tablePos.x, tablePos.y, tablePos.z, 1, 60);

  // Ensure we are looking at or near the table
  const tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    // If table not found at exact coordinates, explore or check inventory
    const inventoryTable = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (inventoryTable) {
      await placeItem('crafting_table', bot.entity.position.x + 1, bot.entity.position.y, bot.entity.position.z);
    } else {
      // Fallback: search nearby
      await exploreUntil('horizontal', 10, () => bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      }));
    }
  }

  // Craft the iron pickaxe
  await craftItem('iron_pickaxe', 1);
}