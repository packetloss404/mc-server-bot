async function mineThreeSpruceLogs(bot) {
  const targetName = 'spruce_log';
  const targetCount = 3;
  const findSpruce = () => bot.findBlock({
    matching: b => b.name === targetName,
    maxDistance: 32
  });
  if (!findSpruce()) {
    await exploreUntil('north', 60, () => findSpruce());
  }
  await mineBlock(targetName, targetCount);
}