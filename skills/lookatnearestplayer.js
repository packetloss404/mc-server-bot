async function lookAtNearestPlayer(bot) {
  const playerFilter = entity => entity.type === 'player';
  const nearestPlayer = bot.nearestEntity(playerFilter);
  if (nearestPlayer) {
    const headPos = nearestPlayer.position.offset(0, nearestPlayer.height || 1.62, 0);
    await bot.lookAt(headPos);
  }
}