async function craftStonePickaxeTask(bot) {
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
      if (!planks || planks.count < 4) {
        let logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
        if (logs) {
          await craftItem(logs.name.replace('_log', '_planks'), 1);
        } else {
          await mineBlock('oak_log', 1);
          await craftItem('oak_planks', 1);
        }
      }
      await craftItem('crafting_table', 1);
    }
    const referenceBlock = bot.findBlock({
      matching: b => b.name !== 'air' && b.name !== 'water' && b.name !== 'lava' && b.boundingBox === 'block',
      maxDistance: 4
    });
    const pos = referenceBlock ? referenceBlock.position.offset(0, 1, 0) : bot.entity.position.offset(1, 0, 0).floored();
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    tableBlock = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }
  if (tableBlock) {
    const dist = bot.entity.position.distanceTo(tableBlock.position);
    if (dist > 3) {
      await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 2, 10);
    }
  }
  let sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 2) {
    await craftItem('stick', 1);
  }
  let cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
  let cobbleCount = cobblestone ? cobblestone.count : 0;
  if (cobbleCount < 3) {
    await mineBlock('stone', 3 - cobbleCount);
  }
  await craftItem('stone_pickaxe', 1);
}