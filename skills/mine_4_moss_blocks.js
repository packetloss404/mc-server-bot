async function mineFourMossBlocks(bot) {
  const targetBlock = 'moss_block';
  const count = 4;
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