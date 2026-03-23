async function craftOneFurnace(bot) {
  let cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
  let cobbleCount = cobblestone ? cobblestone.count : 0;
  if (cobbleCount < 8) {
    await mineBlock('stone', 8 - cobbleCount);
  }
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
      if (!planks || planks.count < 4) {
        await mineBlock('oak_log', 1);
        await craftItem('oak_planks', 1);
      }
      await craftItem('crafting_table', 1);
    }
    const refBlock = bot.findBlock({
      matching: b => b.name !== 'air' && b.name !== 'water' && b.name !== 'lava' && b.boundingBox === 'block',
      maxDistance: 4
    });
    const pos = refBlock ? refBlock.position.offset(0, 1, 0) : bot.entity.position.offset(1, 0, 0).floored();
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    tableBlock = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3);
  }
  await craftItem('furnace', 1);
}