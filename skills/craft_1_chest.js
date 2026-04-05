async function craftOneChest(bot) {
  const existingChest = bot.inventory.items().find(i => i.name === 'chest');
  if (existingChest) return;
  let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  if (!planks || planks.count < 8) {
    const logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    if (!logs || logs.count < 2) {
      await mineBlock('oak_log', 2);
    }
    await craftItem('oak_planks', 2);
    planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  }
  let table = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!table) {
    const tableInInv = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableInInv) {
      await craftItem('crafting_table', 1);
    }
    const pos = bot.entity.position.offset(1, 0, 0).floored();
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    table = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }
  await moveTo(table.position.x, table.position.y, table.position.z, 3, 30);
  await craftItem('chest', 1);
}