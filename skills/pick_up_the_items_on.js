async function pickUpItemsWithinTenMeters(bot) {
  for (let iter = 0; iter < 20; iter++) {
    const itemEntity = bot.nearestEntity(entity => entity.name === 'item' && bot.entity.position.distanceTo(entity.position) <= 10);
    if (!itemEntity) break;
    const {
      x,
      y,
      z
    } = itemEntity.position;
    await moveTo(x, y, z, 1, 10);
    await bot.waitForTicks(5);
  }
}