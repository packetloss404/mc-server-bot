async function mineFourMagmaBlocks(bot) {
  const magmaBlock = bot.findBlock({
    matching: b => b.name === 'magma_block',
    maxDistance: 32
  });
  if (!magmaBlock) {
    await exploreUntil('north', 60, () => {
      return bot.findBlock({
        matching: b => b.name === 'magma_block',
        maxDistance: 32
      });
    });
  }
  await mineBlock('magma_block', 4);
}