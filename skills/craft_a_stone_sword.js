async function craftStoneSword(bot) {
  // 1. Check if we already have a stone sword
  const existingSword = bot.inventory.items().find(i => i.name === 'stone_sword');
  if (existingSword) return;

  // 2. Ensure inventory space by tossing some seeds
  const seeds = bot.inventory.items().find(i => i.name === 'wheat_seeds');
  if (seeds) {
    await bot.toss(seeds.type, null, seeds.count);
  }

  // 3. Ensure we have the materials: 2 cobblestone and 1 stick
  let cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
  let cobbleCount = cobblestone ? cobblestone.count : 0;
  if (cobbleCount < 2) {
    await mineBlock('stone', 2 - cobbleCount);
  }
  let sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!sticks || sticks.count < 1) {
    const planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (planks && planks.count >= 2) {
      await craftItem('stick', 1);
    } else {
      const log = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (log) {
        await craftItem(log.name.replace('_log', '_planks'), 1);
        await craftItem('stick', 1);
      } else {
        await mineBlock('oak_log', 1);
        await craftItem('oak_planks', 1);
        await craftItem('stick', 1);
      }
    }
  }

  // 4. Handle Crafting Table
  let tableBlock = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!tableBlock) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      // Craft a table
      let planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
      if (!planks || planks.count < 4) {
        const log = bot.inventory.items().find(i => i.name.endsWith('_log'));
        if (log) {
          await craftItem(log.name.replace('_log', '_planks'), 1);
        } else {
          await mineBlock('oak_log', 1);
          await craftItem('oak_planks', 1);
        }
        planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
      }
      await craftItem('crafting_table', 1);
      tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    }

    // Place the crafting table
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

  // 5. Move to the crafting table and craft the sword
  if (tableBlock) {
    await moveTo(tableBlock.position.x, tableBlock.position.y, tableBlock.position.z, 3);
    await craftItem('stone_sword', 1);
  } else {
    // Fallback if placement failed or table not found
    await craftItem('stone_sword', 1);
  }
}