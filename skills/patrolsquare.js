async function patrolSquare(bot) {
  const origin = bot.entity.position.clone();
  const size = 15;
  const waypoints = [{
    x: origin.x + size,
    z: origin.z
  }, {
    x: origin.x + size,
    z: origin.z + size
  }, {
    x: origin.x,
    z: origin.z + size
  }, {
    x: origin.x,
    z: origin.z
  }];
  for (const wp of waypoints) {
    await moveTo(wp.x, origin.y, wp.z, 2, 20);
    await bot.waitForTicks(20);
  }
}