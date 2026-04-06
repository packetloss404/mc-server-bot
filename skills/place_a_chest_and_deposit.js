async function placeChestAndDepositUselessItems(bot) {
  let chest = bot.inventory.items().find(i => i.name === 'chest');
  if (!chest) {
    let planks = bot.inventory.items().find(i => i.name.endsWith('_planks') && i.count >= 8);
    if (!planks) {
      let logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
      if (!logs) {
        await mineBlock('oak_log', 2);
        logs = bot.inventory.items().find(i => i.name.endsWith('_log'));
      }
      await craftItem(logs.name.replace('_log', '_planks'), 2);
    }
    await craftItem('chest', 1);
    chest = bot.inventory.items().find(i => i.name === 'chest');
  }
  const pos = bot.entity.position.floored();
  let placePos = null;
  for (let x = -2; x <= 2; x++) {
    for (let z = -2; z <= 2; z++) {
      for (let y = -1; y <= 1; y++) {
        const p = pos.offset(x, y, z);
        const block = bot.blockAt(p);
        const below = bot.blockAt(p.offset(0, -1, 0));
        if (block && block.name === 'air' && below && below.name !== 'air' && !['water', 'lava', 'chest'].includes(below.name)) {
          placePos = p;
          break;
        }
      }
      if (placePos) break;
    }
    if (placePos) break;
  }
  if (!placePos) placePos = pos.offset(1, 0, 1);
  await placeItem('chest', placePos.x, placePos.y, placePos.z);
  const uselessItems = ['cobblestone', 'cobblestone_stairs', 'andesite', 'diorite', 'granite', 'stonecutter', 'dirt', 'gravel', 'oak_door', 'stick'];
  for (const itemName of uselessItems) {
    const itemsToDeposit = bot.inventory.items().filter(i => i.name === itemName);
    for (const item of itemsToDeposit) {
      await depositItem('chest', item.name, item.count);
    }
  }
}