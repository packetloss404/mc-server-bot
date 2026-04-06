async function pickUpNearbyItem(bot) {
  const item = bot.nearestEntity(e => e.name === 'item' || e.type === 'item');
  if (item) {
    const {
      x,
      y,
      z
    } = item.position;
    await moveTo(x, y, z, 1, 15);
    await bot.waitForTicks(10);
  }
}