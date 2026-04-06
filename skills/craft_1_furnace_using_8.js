async function craftFurnaceTask(bot) {
  const cobblestoneCount = bot.inventory.items().filter(i => i.name === 'cobblestone').reduce((acc, i) => acc + i.count, 0);
  if (cobblestoneCount < 8) {
    await mineBlock('stone', 8 - cobblestoneCount);
  }
  let craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      const logItem = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!logItem) {
        await mineBlock('oak_log', 1);
      }
      await craftItem('oak_planks', 1);
      await craftItem('crafting_table', 1);
      tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    }
    const pos = bot.entity.position.offset(1, 0, 0).floored();
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    craftingTable = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }
  await craftItem('furnace', 1);
}