async function placeTableAndCraftFurnace(bot) {
  const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
  const cobbleNeeded = 8 - (cobble ? cobble.count : 0);
  if (cobbleNeeded > 0) {
    await mineBlock('cobblestone', cobbleNeeded);
  }
  let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  if (!tableItem) {
    let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (!planks || planks.count < 4) {
      let log = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!log) {
        await mineBlock('spruce_log', 1);
        log = bot.inventory.items().find(i => i.name === 'spruce_log');
      }
      const plankName = log.name.replace('_log', '_planks');
      await craftItem(plankName, 1);
    }
    await craftItem('crafting_table', 1);
    tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
  }
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    const referenceBlock = bot.findBlock({
      matching: b => b.name !== 'air' && b.name !== 'water' && b.name !== 'lava',
      maxDistance: 4
    });
    const pos = referenceBlock ? referenceBlock.position.offset(0, 1, 0) : bot.entity.position.floored().offset(1, 0, 1);
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    tableBlock = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3, 60);
  }
  await craftItem('furnace', 1);
}