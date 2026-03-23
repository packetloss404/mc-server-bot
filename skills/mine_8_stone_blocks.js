async function mineEightStoneBlocks(bot) {
  const woodenPickaxe = bot.inventory.items().find(i => i.name === 'wooden_pickaxe');
  if (woodenPickaxe) {
    await bot.equip(woodenPickaxe, 'hand');
  }
  const targetBlock = 'stone';
  const count = 8;
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