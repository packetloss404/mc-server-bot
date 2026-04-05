async function mineSixteenCobblestone(bot) {
  let pickaxe = bot.inventory.items().find(i => i.name.includes('pickaxe'));
  if (!pickaxe) {
    const sticks = bot.inventory.items().find(i => i.name === 'stick');
    const cobble = bot.inventory.items().find(i => i.name === 'cobblestone');
    if (sticks && cobble && cobble.count >= 3) {
      await craftItem('stone_pickaxe', 1);
      pickaxe = bot.inventory.items().find(i => i.name === 'stone_pickaxe');
    }
  }
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  const stone = bot.findBlock({
    matching: b => b.name === 'stone',
    maxDistance: 32
  });
  if (!stone) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'stone',
        maxDistance: 32
      });
    });
  }
  await mineBlock('stone', 16);
}