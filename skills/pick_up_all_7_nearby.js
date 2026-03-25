async function pickUpSevenNearbyItems(bot) {
  for (let i = 0; i < 7; i++) {
    const itemEntity = bot.nearestEntity(entity => entity.name === 'item');
    if (!itemEntity) break;
    const {
      x,
      y,
      z
    } = itemEntity.position;
    await moveTo(x, y, z, 1, 10);
    await bot.waitForTicks(10);
  }
}