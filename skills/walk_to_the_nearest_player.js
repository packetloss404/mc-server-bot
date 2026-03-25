async function walkToTheNearestPlayer(bot) {
  const getNearestPlayerEntity = () => {
    return bot.nearestEntity(entity => entity.type === 'player' && entity.username !== bot.username);
  };
  let targetPlayer = getNearestPlayerEntity();
  if (!targetPlayer) {
    // If no player is nearby, explore in a direction to find one
    targetPlayer = await exploreUntil({
      x: 1,
      y: 0,
      z: 0
    }, 60, () => getNearestPlayerEntity());
  }
  if (targetPlayer) {
    const pos = targetPlayer.position;
    await moveTo(pos.x, pos.y, pos.z, 2, 30);
  }
}