async function mine3CopperOreBlocks(bot) {
  const findCopper = () => bot.findBlock({
    matching: block => ['copper_ore', 'deepslate_copper_ore'].includes(block.name),
    maxDistance: 32
  });
  let copperBlock = findCopper();
  if (!copperBlock) {
    await exploreUntil('horizontal', 60, () => findCopper());
    copperBlock = findCopper();
  }
  if (copperBlock) {
    await mineBlock(copperBlock.name, 3);
  }
}