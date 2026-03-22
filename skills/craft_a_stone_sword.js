async function craftStoneSwordTask(bot) {
  const existingSword = bot.inventory.items().find(i => i.name === 'stone_sword');
  if (existingSword) return;

  // 1. Ensure materials: 2 cobblestone, 1 stick
  const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
  if (!cobble || cobble.count < 2) {
    await mineBlock('stone', 2);
  }
  const sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 1) {
    const planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (planks && planks.count >= 2) {
      await craftItem('stick', 1);
    } else {
      await mineBlock('spruce_log', 1);
      await craftItem('spruce_planks', 1);
      await craftItem('stick', 1);
    }
  }

  // 2. Find or create a crafting table
  let table = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!table) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      // Need 4 planks for a table
      let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
      let totalPlanks = planks ? planks.count : 0;
      if (totalPlanks < 4) {
        await mineBlock('spruce_log', 1);
        await craftItem('spruce_planks', 1);
      }
      await craftItem('crafting_table', 1);
      tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    }

    // Place the crafting table
    const referenceBlock = bot.findBlock({
      matching: b => b.name !== 'air' && b.name !== 'water' && b.boundingBox === 'block',
      maxDistance: 4
    });
    const pos = referenceBlock ? referenceBlock.position.offset(0, 1, 0) : bot.entity.position.offset(1, 0, 0).floored();
    await placeItem('crafting_table', pos.x, pos.y, pos.z);
    table = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }

  // 3. Move to table and craft
  if (table) {
    await moveTo(table.position.x, table.position.y, table.position.z, 3);
  }
  await craftItem('stone_sword', 1);

  // 4. Verify
  const finalSword = bot.inventory.items().find(i => i.name === 'stone_sword');
  if (!finalSword) {
    throw new Error('Stone sword not found in inventory after crafting.');
  }
}