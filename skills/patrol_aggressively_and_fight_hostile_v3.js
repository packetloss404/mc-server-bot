async function patrolAndFightHostileMobs(bot) {
  const patrolRadius = 20;
  const startX = bot.entity.position.x;
  const startY = bot.entity.position.y;
  const startZ = bot.entity.position.z;
  const path = [{
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
  }, {
    x: startX,
    y: startY,
    z: startZ
  }];
  for (const target of path) {
    await moveTo(target.x, target.y, target.z, 2, 60);
    const hostileMob = bot.nearestEntity(e => e.type === 'hostile');
    if (!hostileMob) { console.log("Entity not found"); return; }
    if (hostileMob) {
      await killMob(hostileMob.name, 15000);
    }
  }
}