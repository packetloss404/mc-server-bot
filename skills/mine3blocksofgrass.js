async function mineThreeBlocksOfGrass(bot) {
  const targetBlock = 'grass_block';
  const count = 3;
  const block = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!block) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetBlock, count);
}