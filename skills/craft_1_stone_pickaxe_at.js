async function craftStonePickaxe(bot) {
  let cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
  let cobblestoneCount = cobblestone ? cobblestone.count : 0;
  if (cobblestoneCount < 3) {
    // Try to withdraw from a nearby chest first
    const chestBlock = bot.findBlock({ matching: b => b.name === 'chest', maxDistance: 32 });
    if (chestBlock) {
      await moveTo(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2, 30);
      try { await withdrawItem('chest', 'cobblestone', 3 - cobblestoneCount); } catch { /* chest may be empty */ }
      cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
      cobblestoneCount = cobblestone ? cobblestone.count : 0;
    }
  }
  if (cobblestoneCount < 3) {
    await mineBlock('stone', 3 - cobblestoneCount);
  }
  let sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 2) {
    let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (!planks) {
      let logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!logs) {
        await mineBlock('oak_log', 1);
      }
      await craftItem('oak_planks', 1);
    }
    await craftItem('stick', 1);
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
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 2, 30);
  }
  await craftItem('stone_pickaxe', 1);
}
