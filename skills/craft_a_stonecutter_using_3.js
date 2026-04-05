async function craftStonecutter(bot) {
  const currentStone = bot.inventory.items().find(i => i.name === 'stone');
  const stoneCount = currentStone ? currentStone.count : 0;
  if (stoneCount < 3) {
    const cobblestone = bot.inventory.items().find(i => i.name === 'cobblestone');
    if (!cobblestone || cobblestone.count < 3 - stoneCount) {
      await mineBlock('cobblestone', 3 - stoneCount);
    }
    await smeltItem('stone', 'coal', 3 - stoneCount);
  }
  const currentIronIngot = bot.inventory.items().find(i => i.name === 'iron_ingot');
  if (!currentIronIngot) {
    const ironOre = bot.inventory.items().find(i => i.name === 'iron_ore');
    if (!ironOre) {
      await moveTo(907, 64, 400, 2, 60);
      await mineBlock('iron_ore', 1);
    }
    await smeltItem('iron_ingot', 'coal', 1);
  }
  await craftItem('stonecutter', 1);
}