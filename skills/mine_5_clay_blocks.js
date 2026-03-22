async function mineFiveClayBlocks(bot) {
  const targetBlock = 'clay';
  const count = 5;
  const clay = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!clay) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetBlock, count);
}