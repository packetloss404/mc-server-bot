async function patrolSquare(bot) {
  const origin = bot.entity.position;
  const size = 10;
  const waypoints = [
    { x: origin.x + size, y: origin.y, z: origin.z },
    { x: origin.x + size, y: origin.y, z: origin.z + size },
    { x: origin.x, y: origin.y, z: origin.z + size },
    { x: origin.x, y: origin.y, z: origin.z },
  ];
  for (const wp of waypoints) {
    console.log(`Patrolling to ${wp.x.toFixed(0)}, ${wp.z.toFixed(0)}`);
    await moveTo(wp.x, wp.y, wp.z, 2, 15);
    await bot.waitForTicks(40);
  }
  console.log('Patrol complete');
}
