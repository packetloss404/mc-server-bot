async function patrolAndFightHostileMobs(bot) {
  const patrolRadius = 20;
  const startX = Math.floor(bot.entity.position.x);
  const startY = Math.floor(bot.entity.position.y);
  const startZ = Math.floor(bot.entity.position.z);
  const waypoints = [{
    x: startX + patrolRadius,
    y: startY,
    z: startZ + patrolRadius
  }, {
    x: startX - patrolRadius,
    y: startY,
    z: startZ + patrolRadius
  }, {
    x: startX - patrolRadius,
    y: startY,
    z: startZ - patrolRadius
  }, {
    x: startX + patrolRadius,
    y: startY,
    z: startZ - patrolRadius
  }];
  for (const waypoint of waypoints) {
    await moveTo(waypoint.x, waypoint.y, waypoint.z, 2, 60);
    const hostileMob = bot.nearestEntity(e => e.type === 'hostile');
    if (!hostileMob) { console.log("Entity not found"); return; }
    if (hostileMob) {
      await killMob(hostileMob.name, 15000);
    }
  }
  await moveTo(startX, startY, startZ, 2, 60);
}