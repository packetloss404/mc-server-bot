async function pickUpNearbyItem(bot) {
  const item = bot.nearestEntity(e => e.name === 'item' || e.type === 'item');
  if (item) {
    const {
      x,
      y,
      z
    } = item.position;
    await moveTo(x, y, z, 0, 15);
    await bot.waitForTicks(20);
  }
}