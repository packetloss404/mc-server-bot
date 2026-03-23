async function mineThreeIronOre(bot) {
  const targetBlock = 'iron_ore';
  const targetCount = 3;
  const ironOre = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!ironOre) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetBlock, targetCount);
}