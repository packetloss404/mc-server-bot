async function craftIronPickaxe(bot) {
  let sticks = bot.inventory.items().find(i => i.name === 'stick');
  let craftingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!sticks || sticks.count < 2 || !craftingTable && !tableBlock) {
    let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (!planks || planks.count < 5) {
      let logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!logs) {
        await mineBlock('oak_log', 1);
        logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
      }
      const plankType = logs ? logs.name.replace('_log', '_planks') : 'oak_planks';
      await craftItem(plankType, 2);
    }
  }
  sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 2) {
    await craftItem('stick', 1);
  }
  craftingTable = bot.inventory.items().find(i => i.name === 'crafting_table');
  tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!craftingTable && !tableBlock) {
    await craftItem('crafting_table', 1);
  }
  await craftItem('iron_pickaxe', 1);
}