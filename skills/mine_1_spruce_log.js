async function mineOneSpruceLog(bot) {
  const targetName = 'spruce_log';
  const findSpruce = () => bot.findBlock({
    matching: b => b.name === targetName,
    maxDistance: 32
  });
  if (!findSpruce()) {
    await exploreUntil({
      x: 0,
      y: 0,
      z: 1
    }, 60, () => findSpruce());
  }
  await mineBlock(targetName, 1);
}