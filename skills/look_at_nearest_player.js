async function lookAtNearestPlayer(bot) {
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
    const dist = Math.sqrt(
      (p.entity.position.x - myPos.x) ** 2 +
      (p.entity.position.y - myPos.y) ** 2 +
      (p.entity.position.z - myPos.z) ** 2
    );
    if (dist < nearestDist) {
      nearest = p;
      nearestDist = dist;
    }
  }
  const headPos = new Vec3(nearest.entity.position.x, nearest.entity.position.y + 1.6, nearest.entity.position.z);
  await bot.lookAt(headPos);
  console.log(`Looking at ${nearest.username}`);
}
