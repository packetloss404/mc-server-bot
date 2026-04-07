async function craftThreeOakDoors(bot) {
  let oakPlanks = bot.inventory.items().find(i => i.name === 'oak_planks');
  if (!oakPlanks || oakPlanks.count < 6) {
    const oakLogs = bot.inventory.items().find(i => i.name === 'oak_log');
    if (!oakLogs) {
      await mineBlock('oak_log', 1);
    }
    await craftItem('oak_planks', 2);
  }
  let tableBlock = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 32 });
  if (!tableBlock) {
    let table = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!table) {
      await craftItem('crafting_table', 1);
    }
    const pos = bot.entity.position;
    await placeItem('crafting_table', Math.floor(pos.x) + 1, Math.floor(pos.y), Math.floor(pos.z));
    tableBlock = bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 8 });
  }
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3, 20);
  }
  await craftItem('oak_door', 1);
}