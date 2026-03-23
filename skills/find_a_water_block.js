async function findWaterBlock(bot) {
  let waterBlock = bot.findBlock({
    matching: b => b.name === 'water',
    maxDistance: 32
  });
  if (!waterBlock) {
    waterBlock = await exploreUntil(new (require('vec3'))(1, 0, 0), 60, () => bot.findBlock({
      matching: b => b.name === 'water',
      maxDistance: 32
    }));
  }
  if (waterBlock) {
    await moveTo(waterBlock.position.x, waterBlock.position.y, waterBlock.position.z, 2, 60);
  }
}