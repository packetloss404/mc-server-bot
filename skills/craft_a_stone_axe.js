async function craftStoneAxe(bot) {
  const existingAxe = bot.inventory.items().find(i => i.name === 'stone_axe');
  if (existingAxe) return;
  const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
  const sticks = bot.inventory.items().find(i => i.name === 'stick');
  if (!cobble || cobble.count < 3) {
    await mineBlock('stone', 3 - (cobble ? cobble.count : 0));
  }
  if (!sticks || sticks.count < 2) {
    const planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (planks && planks.count >= 1) {
      await craftItem('stick', 1);
    } else {
      await mineBlock('oak_log', 1);
      await craftItem('oak_planks', 1);
      await craftItem('stick', 1);
    }
  }
  let table = bot.findBlock({
    matching: b => b.name === 'crafting_table',
    maxDistance: 32
  });
  if (!table) {
    let tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    if (!tableItem) {
      const planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
      if (!planks || planks.count < 4) {
        await mineBlock('oak_log', 1);
        await craftItem('oak_planks', 1);
      }
      await craftItem('crafting_table', 1);
      tableItem = bot.inventory.items().find(i => i.name === 'crafting_table');
    }
    const searchRange = 4;
    let placePos = null;
    for (let x = -searchRange; x <= searchRange; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -searchRange; z <= searchRange; z++) {
          const pos = bot.entity.position.offset(x, y, z).floored();
          const block = bot.blockAt(pos);
          const below = bot.blockAt(pos.offset(0, -1, 0));
          if (block && block.name === 'air' && below && below.boundingBox === 'block' && below.name !== 'air') {
            placePos = pos;
            break;
          }
        }
        if (placePos) break;
      }
      if (placePos) break;
    }
    if (!placePos) {
      placePos = bot.entity.position.offset(1, 0, 0).floored();
    }
    await placeItem('crafting_table', placePos.x, placePos.y, placePos.z);
    table = bot.findBlock({
      matching: b => b.name === 'crafting_table',
      maxDistance: 32
    });
  }
  if (table) {
    await moveTo(table.position.x, table.position.y, table.position.z, 3);
  }
  await craftItem('stone_axe', 1);
  const finalAxe = bot.inventory.items().find(i => i.name === 'stone_axe');
  if (!finalAxe) {
    throw new Error('Failed to craft stone_axe.');
  }
}