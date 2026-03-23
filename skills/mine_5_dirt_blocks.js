async function mineFiveDirtBlocks(bot) {
  const targetBlock = 'dirt';
  const targetCount = 5;
  const dirtBlock = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!dirtBlock) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetBlock, targetCount);
}