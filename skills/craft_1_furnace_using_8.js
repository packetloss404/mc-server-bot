async function craftOneFurnace(bot) {
  const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
  const cobbleCount = cobble ? cobble.count : 0;
  if (cobbleCount < 8) {
    await mineTwelveCobblestone(bot);
  }
  let table = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!table) {
    const tableInInv = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableInInv) {
      await craftCraftingTableFromOakPlanks(bot);
    }
    const referenceBlock = bot.findBlock({
      matching: b => b.name !== 'air' && b.name !== 'water' && b.name !== 'lava',
      maxDistance: 4
    });
    if (referenceBlock) {
      await placeItem('crafting_table', referenceBlock.position.x, referenceBlock.position.y + 1, referenceBlock.position.z);
    } else {
      const pos = bot.entity.position.floored().offset(1, -1, 1);
      await placeItem('crafting_table', pos.x, pos.y, pos.z);
    }
    table = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }
  if (table) {
    await moveTo(table.position.x, table.position.y, table.position.z, 3, 60);
  }
  await craftItem('furnace', 1);
}