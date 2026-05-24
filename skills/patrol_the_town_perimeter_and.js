async function patrolTheTownPerimeter(bot) {
  await swimToTheSurfaceDrowning(bot);
  const patrolRadius = 30;
  const startPos = bot.entity.position.clone();
  const hostileCheckRadius = 16;

  // Check for nearby hostile mobs and engage
  const hostiles = bot.nearestEntity(e => e.type === 'hostile' && e.position.distanceTo(bot.entity.position) < hostileCheckRadius);
  if (hostiles) {
    await killMob('zombie', 10000);
    await killMob('skeleton', 10000);
    await killMob('spider', 10000);
    await killMob('creeper', 10000);
    await killMob('phantom', 10000);
    await killMob('enderman', 10000);
    await killMob('drowned', 10000);
    await killMob('husk', 10000);
    await killMob('stray', 10000);
    await killMob('witch', 10000);
    await killMob('phantom', 10000);
    await killMob('shulker', 10000);
    await killMob('vex', 10000);
    await killMob('evoker', 10000);
    await killMob('vindicator', 10000);
    await killMob('pillager', 10000);
    await killMob('ravager', 10000);
    await killMob('ghast', 10000);
    await killMob('blaze', 10000);
    await killMob('wither_skeleton', 10000);
    await killMob('ender_dragon', 10000);
    await killMob('wither', 10000);
    await killMob('magma_cube', 10000);
    await killMob('slime', 10000);
    await killMob('zombie_villager', 10000);
    await killMob('piglin_brute', 10000);
    await killMob('hoglin', 10000);
    await killMob('zoglin', 10000);
  }

  // Patrol perimeter - move to various points around the town center
  const patrolPoints = [{
    x: startPos.x + patrolRadius,
    y: startPos.y,
    z: startPos.z
  }, {
    x: startPos.x + patrolRadius,
    y: startPos.y,
    z: startPos.z + patrolRadius
  }, {
    x: startPos.x,
    y: startPos.y,
    z: startPos.z + patrolRadius
  }, {
    x: startPos.x - patrolRadius,
    y: startPos.y,
    z: startPos.z + patrolRadius
  }, {
    x: startPos.x - patrolRadius,
    y: startPos.y,
    z: startPos.z
  }, {
    x: startPos.x - patrolRadius,
    y: startPos.y,
    z: startPos.z - patrolRadius
  }, {
    x: startPos.x,
    y: startPos.y,
    z: startPos.z - patrolRadius
  }, {
    x: startPos.x + patrolRadius,
    y: startPos.y,
    z: startPos.z - patrolRadius
  }];
  for (const point of patrolPoints) {
    // Check for hostiles before moving
    const nearbyHostile = bot.nearestEntity(e => e.type === 'hostile' && e.position.distanceTo(bot.entity.position) < hostileCheckRadius);
    if (nearbyHostile) {
      await killMob('zombie', 8000);
      await killMob('skeleton', 8000);
      await killMob('spider', 8000);
      await killMob('creeper', 8000);
      await killMob('phantom', 8000);
      await killMob('drowned', 8000);
      await killMob('husk', 8000);
      await killMob('stray', 8000);
    }
    await moveTo(point.x, point.y, point.z, 2, 15);
    await bot.waitForTicks(10);

    // Quick scan for threats after arriving
    const threatAfterMove = bot.nearestEntity(e => e.type === 'hostile' && e.position.distanceTo(bot.entity.position) < hostileCheckRadius);
    if (threatAfterMove) {
      await killMob('zombie', 8000);
      await killMob('skeleton', 8000);
      await killMob('spider', 8000);
      await killMob('creeper', 8000);
      await killMob('phantom', 8000);
      await killMob('drowned', 8000);
      await killMob('husk', 8000);
      await killMob('stray', 8000);
    }
  }

  // Return to start
  await moveTo(startPos.x, startPos.y, startPos.z, 2, 15);
}