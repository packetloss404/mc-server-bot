async function mineFiveSpruceLogsWithStoneAxe(bot) {
  let stoneAxe = bot.inventory.items().find(i => i.name === 'stone_axe');
  if (!stoneAxe) {
    const sticks = bot.inventory.items().find(i => i.name === 'stick');
    if (!sticks || sticks.count < 2) {
      await craftItem('stick', 1);
    }
    await craftItem('stone_axe', 1);
    stoneAxe = bot.inventory.items().find(i => i.name === 'stone_axe');
  }
  if (stoneAxe) {
    await bot.equip(stoneAxe, 'hand');
  }
  const spruceLog = bot.findBlock({
    matching: b => b.name === 'spruce_log',
    maxDistance: 32
  });
  if (!spruceLog) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'spruce_log',
        maxDistance: 32
      });
    });
  }
  await mineBlock('spruce_log', 5);
}