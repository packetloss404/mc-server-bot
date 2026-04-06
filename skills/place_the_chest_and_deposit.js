async function placeChestAndDepositCobblestone(bot) {
  let chestItem = bot.inventory.items().find(i => i.name === 'chest');
  if (!chestItem) {
    const planks = bot.inventory.items().find(i => i.name.endsWith('_planks'));
    if (!planks || planks.count < 8) {
      const logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (logs) {
        const plankType = logs.name.replace('_log', '_planks');
        await craftItem(plankType, 2);
      } else {
        await mineBlock('oak_log', 2);
        await craftItem('oak_planks', 2);
      }
    }
    await craftItem('chest', 1);
  }
  let chestBlock = bot.findBlock({
    matching: b => b.name === 'chest',
    maxDistance: 5
  });
  if (!chestBlock) {
    const pos = bot.entity.position.floored();
    const offsets = [[1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [2, 0, 0], [0, 0, 2], [-2, 0, 0], [0, 0, -2]];
    let targetPos = null;
    for (const o of offsets) {
      const p = pos.offset(o[0], o[1], o[2]);
      const block = bot.blockAt(p);
      const below = bot.blockAt(p.offset(0, -1, 0));
      if (block && block.name === 'air' && below && below.name !== 'air' && !below.name.includes('water') && !below.name.includes('lava')) {
        targetPos = p;
        break;
      }
    }
    if (!targetPos) targetPos = pos.offset(1, 0, 1);
    await placeItem('chest', targetPos.x, targetPos.y, targetPos.z);
  }
  await depositItem('chest', 'cobblestone', 64);
}