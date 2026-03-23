async function patrolSquarePattern(bot) {
  const origin = bot.entity.position;
  const size = 10;
  const waypoints = [{
    x: origin.x + size,
    y: origin.y,
    z: origin.z
  }, {
    x: origin.x + size,
    y: origin.y,
    z: origin.z + size
  }, {
    x: origin.x,
    y: origin.y,
    z: origin.z + size
  }, {
    x: origin.x,
    y: origin.y,
    z: origin.z
  }];
  const startTime = Date.now();
  const durationMs = 2 * 60 * 1000; // 2 minutes

  while (Date.now() - startTime < durationMs) {
    for (const wp of waypoints) {
      if (Date.now() - startTime >= durationMs) break;
      await moveTo(wp.x, wp.y, wp.z, 2, 15);
      await bot.waitForTicks(40);
    }
  }
}