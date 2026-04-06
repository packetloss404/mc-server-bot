async function mineEightSandAtWaterSource(bot) {
  const waterSourcePos = {
    x: 976,
    y: 57,
    z: 375
  };
  await moveTo(waterSourcePos.x, waterSourcePos.y, waterSourcePos.z, 5, 60);
  const findSand = () => bot.findBlock({
    matching: b => b.name === 'sand',
    maxDistance: 32
  });
  let sandBlock = findSand();
  if (!sandBlock) {
    await exploreUntil({
      x: 1,
      y: 0,
      z: 0
    }, 60, () => {
      return findSand();
    });
  }
  await mineBlock('sand', 8);
}