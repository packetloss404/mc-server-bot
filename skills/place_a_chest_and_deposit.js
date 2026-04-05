async function placeChestAndDepositUselessItems(bot) {
  let chestItem = bot.inventory.items().find(i => i.name === 'chest');
  if (!chestItem) {
    const planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (!planks || planks.count < 8) {
      const logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (logs) {
        await craftItem(logs.name.replace('_log', '_planks'), 2);
      } else {
        await mineBlock('oak_log', 2);
        await craftItem('oak_planks', 2);
      }
    }
    await craftItem('chest', 1);
  }
  let chestBlock = bot.findBlock({
    matching: b => b.name === 'chest',
    maxDistance: 4
  });
  if (!chestBlock) {
    const pos = bot.entity.position.floored();
    const offsets = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 0, 1], [1, 0, -1]];
    let placed = false;
    for (const offset of offsets) {
      const p = pos.offset(offset[0], offset[1], offset[2]);
      const block = bot.blockAt(p);
      const below = bot.blockAt(p.offset(0, -1, 0));
      if (block && block.name === 'air' && below && below.name !== 'air') {
        await placeItem('chest', p.x, p.y, p.z);
        placed = true;
        break;
      }
    }
    if (!placed) {
      await placeItem('chest', pos.x + 1, pos.y, pos.z);
    }
  }
  const uselessItems = ['cobblestone', 'stone', 'dirt', 'gravel', 'andesite', 'diorite', 'granite', 'tuff', 'stone_bricks', 'stone_brick_stairs', 'spruce_planks', 'oak_planks'];
  for (const itemName of uselessItems) {
    const itemInInv = bot.inventory.items().find(i => i.name === itemName);
    if (itemInInv && itemInInv.count > 0) {
      try {
        await depositItem('chest', itemName, itemInInv.count);
      } catch (e) {
        continue;
      }
    }
  }
}