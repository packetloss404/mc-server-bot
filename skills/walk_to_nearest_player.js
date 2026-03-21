async function walkToNearestPlayer(bot) {
  const players = Object.values(bot.players).filter(p => p.entity);
  if (players.length === 0) {
    console.log('No players nearby');
    return;
  }
  let nearest = players[0];
  let nearestDist = Infinity;
  const myPos = bot.entity.position;
  for (const p of players) {
    if (!p.entity) continue;
    const dx = p.entity.position.x - myPos.x;
    const dz = p.entity.position.z - myPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < nearestDist) {
      nearest = p;
      nearestDist = dist;
    }
  }
  console.log(`Walking to ${nearest.username}`);
  const tp = nearest.entity.position;
  await moveTo(tp.x, tp.y, tp.z, 3, 15);
  console.log(`Reached ${nearest.username}`);
}
