async function mineThreeBlocksOfGrass(bot) {
  const blockName = 'grass_block';
  let target = bot.findBlock({
    matching: b => b.name === blockName,
    maxDistance: 32
  });
  if (!target) {
    await exploreUntil(bot, 'north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === blockName,
        maxDistance: 32
      });
    });
  }
  await mineBlock(blockName, 3);
}