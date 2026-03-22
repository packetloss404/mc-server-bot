async function mineTwoStoneWithPickaxe(bot) {
  const pickaxe = bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
  if (pickaxe) {
    await bot.equip(pickaxe, 'hand');
  }
  const targetBlock = 'stone';
  const count = 2;
  const stone = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!stone) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetBlock, count);
}