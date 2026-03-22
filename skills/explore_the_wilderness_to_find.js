async function findDecorativeBlockForHall(bot) {
  const decorativeBlocks = ['moss_block', 'azalea', 'flowering_azalea', 'calcite', 'amethyst_block', 'deepslate'];
  const targetBlock = await exploreUntil({
    x: 1,
    y: 0,
    z: 1
  }, 60, () => {
    return bot.findBlock({
      matching: b => decorativeBlocks.includes(b.name),
      maxDistance: 32
    });
  });
  if (targetBlock) {
    await mineBlock(targetBlock.name, 1);
  }
}