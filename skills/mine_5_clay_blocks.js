async function mineFiveClayBlocks(bot) {
  const targetBlock = 'clay';
  const targetCount = 5;
  const clayBlock = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!clayBlock) {
    await exploreUntil('north', 120, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetBlock, targetCount);
}