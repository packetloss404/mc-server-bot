async function craftWoodenPickaxe(bot) {
  const existingPickaxe = bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
  if (existingPickaxe) return;

  // Need 3 planks and 2 sticks
  let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  let sticks = bot.inventory.items().find(i => i.name === 'stick');

  // Collect logs if we don't have enough materials
  const plankCount = planks ? planks.count : 0;
  const stickCount = sticks ? sticks.count : 0;
  if (plankCount < 3 || stickCount < 2) {
    const logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    if (!logs || logs.count < 2) {
      await mineBlock('oak_log', 2);
    }
  }

  // Craft planks if needed
  planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  if (!planks || planks.count < 5) {
    // 3 for pickaxe, 2 for sticks
    await craftItem('oak_planks', 2);
  }

  // Craft sticks if needed
  sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 2) {
    await craftItem('stick', 1);
  }

  // Ensure crafting table is placed
  let table = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!table) {
    const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (tableItem) {
      const pos = bot.entity.position.offset(1, 0, 0);
      await placeItem('crafting_table', pos.x, pos.y, pos.z);
      table = bot.findBlock({
        matching: b => b.name === 'crafting_table',
        maxDistance: 32
      });
    }
  }
  if (table) {
    await moveTo(table.position.x, table.position.y, table.position.z, 4, 10);
  }
  await craftItem('wooden_pickaxe', 1);
}