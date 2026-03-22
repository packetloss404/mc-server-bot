async function craftStonePickaxe(bot) {
  const cobblestoneCount = () => bot.inventory.items().filter(i => i.name === 'cobblestone').reduce((acc, i) => acc + i.count, 0);
  const sticksCount = () => bot.inventory.items().filter(i => i.name === 'stick').reduce((acc, i) => acc + i.count, 0);
  if (cobblestoneCount() < 3) {
    await mineBlock('stone', 3 - cobblestoneCount());
  }
  if (sticksCount() < 2) {
    await craftFourSticksTask(bot);
  }
  let craftingTable = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable) {
    const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (tableItem) {
      const pos = bot.entity.position.offset(1, 0, 1).floored();
      await placeItem('crafting_table', pos.x, pos.y, pos.z);
      craftingTable = bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      });
    } else {
      await craftCraftingTableTask(bot);
      const pos = bot.entity.position.offset(1, 0, 1).floored();
      await placeItem('crafting_table', pos.x, pos.y, pos.z);
      craftingTable = bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      });
    }
  }
  if (craftingTable) {
    await moveTo(craftingTable.position.x, craftingTable.position.y, craftingTable.position.z, 3);
  }
  await craftItem('stone_pickaxe', 1);
}