async function mineEightSand(bot) {
  const findSand = () => bot.findBlock({
    matching: block => block.name === 'sand',
    maxDistance: 32
  });
  let sandBlock = findSand();
  if (!sandBlock) {
    await exploreUntil({
      x: 0,
      y: 0,
      z: 1
    }, 60, () => findSand());
  }
  await mineBlock('sand', 8);
}