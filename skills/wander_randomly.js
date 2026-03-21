async function wanderRandomly(bot) {
  const pos = bot.entity.position;
  const dx = (Math.random() - 0.5) * 20;
  const dz = (Math.random() - 0.5) * 20;
  const target = { x: pos.x + dx, y: pos.y, z: pos.z + dz };
  console.log(`Walking to ${target.x.toFixed(0)}, ${target.y.toFixed(0)}, ${target.z.toFixed(0)}`);
  await moveTo(target.x, target.y, target.z, 2, 15);
  console.log('Arrived at destination');
}
