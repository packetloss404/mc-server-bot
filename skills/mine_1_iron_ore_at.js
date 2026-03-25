async function mineOneIronOreAtTarget(bot) {
  const targetX = 886;
  const targetY = 70;
  const targetZ = 209;
  await moveTo(targetX, targetY, targetZ, 3, 60);
  const findIron = () => bot.findBlock({
    matching: block => ['iron_ore', 'deepslate_iron_ore'].includes(block.name),
    maxDistance: 32
  });
  let targetBlock = findIron();
  if (!targetBlock) {
    targetBlock = await exploreUntil('north', 30, () => findIron());
  }
  if (targetBlock) {
    await mineBlock(targetBlock.name, 1);
  }
}