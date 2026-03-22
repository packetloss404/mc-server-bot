async function pickUpTenNearbyItems(bot) {
  for (let i = 0; i < 10; i++) {
    const itemEntity = bot.nearestEntity(entity => entity.name === 'item' || entity.type === 'item');
    if (!itemEntity) {
      break;
    }
    const {
      x,
      y,
      z
    } = itemEntity.position;
    await moveTo(x, y, z, 1, 10);
    await bot.waitForTicks(5);
  }
}