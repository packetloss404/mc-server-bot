async function pickUpNearbyItems(bot) {
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    const itemEntity = bot.nearestEntity(entity => entity.name === 'item');
    if (!itemEntity) break;
    if (bot.entity.position.distanceTo(itemEntity.position) > 16) break;
    const {
      x,
      y,
      z
    } = itemEntity.position;
    await moveTo(x, y, z, 1, 10);
    await bot.waitForTicks(10);
  }
}