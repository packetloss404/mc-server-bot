async function craftStonePickaxe(bot) {
  const tablePos = {
    x: 947,
    y: 71,
    z: 363
  };
  const chestPos = {
    x: 949,
    y: 69,
    z: 362
  };
  let cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
  let cobblestoneCount = cobblestone ? cobblestone.count : 0;
  if (cobblestoneCount < 3) {
    await moveTo(chestPos.x, chestPos.y, chestPos.z, 2);
    await withdrawItem('chest', 'cobblestone', 3 - cobblestoneCount);
    cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
    cobblestoneCount = cobblestone ? cobblestone.count : 0;
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
  await moveTo(tablePos.x, tablePos.y, tablePos.z, 2);
  await craftItem('stone_pickaxe', 1);
}