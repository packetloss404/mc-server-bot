async function mineSixteenDirt(bot) {
  const findDirt = () => bot.findBlock({
    matching: block => block.name === 'dirt',
    maxDistance: 32
  });
  let dirtBlock = findDirt();
  if (!dirtBlock) {
    await exploreUntil({
      x: 1,
      y: 0,
      z: 0
    }, 60, () => findDirt());
  }
  await mineBlock('dirt', 16);
}