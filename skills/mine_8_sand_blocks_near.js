async function mineEightSandNearWater(bot) {
  const waterPos = {
    x: 1026,
    y: 62,
    z: 408
  };
  await moveTo(waterPos.x, waterPos.y, waterPos.z, 10, 60);
  const findSand = () => bot.findBlock({
    matching: b => b.name === 'sand',
    maxDistance: 32
  });
  let sandBlock = findSand();
  if (!sandBlock) {
    await exploreUntil({
      x: 0,
      y: 0,
      z: 1
    }, 60, () => {
      return findSand();
    });
  }
  await mineBlock('sand', 8);
}