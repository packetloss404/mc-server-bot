async function craftWoodenSword(bot) {
  let craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (tableItem) {
      const pos = bot.entity.position.offset(1, 0, 0);
      await placeItem('crafting_table', pos.x, pos.y, pos.z);
      craftingTable = bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      });
    }
  }
  if (craftingTable) {
    await moveTo(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 3, 10);
  }
  await craftItem('wooden_sword', 1);
}