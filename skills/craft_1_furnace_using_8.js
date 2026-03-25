async function craftFurnace(bot) {
  const cobblestoneCount = bot.inventory.items().filter(i => i.name === 'cobblestone').reduce((acc, i) => acc + i.count, 0);
  if (cobblestoneCount < 8) {
    await mineBlock('stone', 8 - cobblestoneCount);
  }
  let craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (tableItem) {
      const pos = bot.entity.position.offset(1, -1, 1).floored();
      await placeItem('crafting_table', pos.x, pos.y, pos.z);
      craftingTable = bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      });
    }
  }
  await craftItem('furnace', 1);
}