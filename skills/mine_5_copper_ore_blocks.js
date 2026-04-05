async function mineFiveCopperOreBlocks(bot) {
  const findCopper = () => bot.findBlock({
    matching: block => ['copper_ore', 'deepslate_copper_ore'].includes(block.name),
    maxDistance: 32
  });
  let targetBlock = findCopper();
  if (!targetBlock) {
    await exploreUntil('horizontal', 60, () => !!findCopper());
    targetBlock = findCopper();
  }
  if (targetBlock) {
    await mineBlock(targetBlock.name, 5);
  }
}