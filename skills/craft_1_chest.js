async function craftOneChest(bot) {
  const existingChest = bot.inventory.items().find(i => i.name === 'chest');
  if (existingChest) return;
  let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  let plankCount = planks ? planks.count : 0;
  if (plankCount < 8) {
    const logsNeeded = Math.ceil((8 - plankCount) / 4);
    let logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    let logCount = logs ? logs.count : 0;
    if (logCount < logsNeeded) {
      await mineBlock('oak_log', logsNeeded - logCount);
    }
    await craftItem('oak_planks', logsNeeded);
  }
  let table = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!table) {
    let tableInInv = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableInInv) {
      let currentPlanks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
      if (!currentPlanks || currentPlanks.count < 4) {
        await mineBlock('oak_log', 1);
        await craftItem('oak_planks', 1);
      }
      await craftItem('crafting_table', 1);
      tableInInv = bot.inventory.items().find(i => i.name === 'crafting_table');
    }
    const pos = bot.entity.position.offset(1, 0, 0).floored();
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    table = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }
  await moveTo(table.position.x, table.position.y, table.position.z, 3);
  await craftItem('chest', 1);
}