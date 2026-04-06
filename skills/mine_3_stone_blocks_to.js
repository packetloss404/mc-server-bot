async function mineThreeStoneToUpgradeTools(bot) {
  const stoneBlocks = ['stone', 'andesite', 'diorite', 'granite'];
  const targetBlock = bot.findBlock({
    matching: block => stoneBlocks.includes(block.name),
    maxDistance: 32
  });
  if (!targetBlock) {
    await exploreUntil(bot, 'south', 60, () => {
      return bot.findBlock({
        matching: block => stoneBlocks.includes(block.name),
        maxDistance: 32
      });
    });
  }
  const foundBlock = bot.findBlock({
    matching: block => stoneBlocks.includes(block.name),
    maxDistance: 32
  });
  if (foundBlock) {
    await mineBlock(foundBlock.name, 3);
  }
}