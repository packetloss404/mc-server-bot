async function craftWoodenPickaxe(bot) {
  const woodenPickaxe = bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
  if (woodenPickaxe) return;

  // 1. Ensure we have enough planks (need 3 for pickaxe)
  let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
  if (!planks || planks.count < 3) {
    const logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    if (!logs) {
      await mineBlock('oak_log', 1);
    }
    const updatedLogs = bot.inventory.items().find(i => i.name.endsWith('_log'));
    if (updatedLogs) {
      // Craft planks from logs (1 log = 4 planks)
      const plankName = updatedLogs.name.replace('_log', '_planks');
      await craftItem(plankName, 1);
    }
  }

  // 2. Ensure we have enough sticks (need 2 for pickaxe)
  let sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 2) {
    const updatedPlanks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (updatedPlanks) {
      await craftItem('stick', 1);
    }
  }

  // 3. Handle Crafting Table
  let table = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!table) {
    const tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      const updatedPlanks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
      if (!updatedPlanks || updatedPlanks.count < 4) {
        const logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
        if (logs) {
          const plankName = logs.name.replace('_log', '_planks');
          await craftItem(plankName, 1);
        } else {
          await mineBlock('oak_log', 1);
          const newLogs = bot.inventory.items().find(i => i.name.endsWith('_log'));
          await craftItem(newLogs.name.replace('_log', '_planks'), 1);
        }
      }
      await craftItem('crafting_table', 1);
    }
    // Place the table
    const pos = bot.entity.position.floored().offset(1, 0, 0);
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    table = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }

  // 4. Move to table and craft the pickaxe
  if (table) {
    await moveTo(table.position.x, table.position.y, table.position.z, 3);
    await craftItem('wooden_pickaxe', 1);
  }
}