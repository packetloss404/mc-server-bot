async function goToPlayer(bot) {
  try {
    const players = Object.values(bot.players).filter(p => p.entity);
    if (players.length === 0) {
      bot.chat('No players nearby');
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
    const tp = nearest.entity.position;
    bot.chat(`Going to player at ${tp.x}, ${tp.y}, ${tp.z}`);
    await moveTo(tp.x, tp.y, tp.z, 3, 15);
    bot.chat('Reached the player');
  } catch (err) {
    bot.chat(`Error: ${err}`);
  }
}