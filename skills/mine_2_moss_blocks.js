async function mineTwoMossBlocks(bot) {
  const targetBlock = 'moss_block';
  const count = 2;
  const moss = bot.findBlock({
    matching: b => b.name === targetBlock,
    maxDistance: 32
  });
  if (!moss) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === targetBlock,
        maxDistance: 32
      });
    });
  }
  await mineBlock(targetBlock, count);
}