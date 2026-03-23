async function craftWoodenPickaxe(bot) {
  const initialCount = bot.inventory.items().filter(i => i.name === 'wooden_pickaxe').reduce((acc, i) => acc + i.count, 0);

  // 1. Ensure we have enough planks (3 required)
  let planks = bot.inventory.items().filter(i => i.name.endsWith('_planks')).reduce((acc, i) => acc + i.count, 0);
  if (planks < 3) {
    const logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    if (!logs) {
      await mineBlock('oak_log', 1);
    }
    const logToUse = bot.inventory.items().find(i => i.name.endsWith('_log'));
    await craftItem(logToUse.name.replace('_log', '_planks'), 1);
  }

  // 2. Ensure we have enough sticks (2 required)
  let sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 2) {
    const planksForSticks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (!planksForSticks || planksForSticks.count < 2) {
      const logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
      await craftItem(logs.name.replace('_log', '_planks'), 1);
    }
    await craftItem('stick', 1);
  }

  // 3. Locate or place crafting table
  let table = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!table) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      let planksForTable = bot.inventory.items().filter(i => i.name.endsWith('_planks')).reduce((acc, i) => acc + i.count, 0);
      if (planksForTable < 4) {
        const logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
        await craftItem(logs.name.replace('_log', '_planks'), 1);
      }
      await craftItem('crafting_table', 1);
    }
    const refBlock = bot.findBlock({
      matching: b => b.name !== 'air' && b.name !== 'water' && b.boundingBox === 'block',
      maxDistance: 4
    });
    const pos = refBlock ? refBlock.position.offset(0, 1, 0) : bot.entity.position.offset(1, 0, 0).floored();
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    table = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }

  // 4. Move to table and craft
  if (table) {
    await moveTo(table.position.x, table.position.y, table.position.z, 3);
  }
  await craftItem('wooden_pickaxe', 1);

  // 5. Verify
  const finalCount = bot.inventory.items().filter(i => i.name === 'wooden_pickaxe').reduce((acc, i) => acc + i.count, 0);
  if (finalCount <= initialCount) {
    throw new Error(`Failed to craft wooden_pickaxe. Inventory count did not increase.`);
  }
}