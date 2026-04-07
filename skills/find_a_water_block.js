async function findWaterBlock(bot) {
  let waterBlock = bot.findBlock({
    matching: b => b.name === 'water',
    maxDistance: 32
  });
  if (!waterBlock) {
    waterBlock = await exploreUntil({ x: 1, y: 0, z: 0 }, 60, () => bot.findBlock({
      matching: b => b.name === 'water',
      maxDistance: 32
    }));
  }
  if (waterBlock) {
    await moveTo(waterBlock.position.x, waterBlock.position.y, waterBlock.position.z, 2, 60);
  }
}