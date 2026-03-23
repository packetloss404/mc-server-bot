async function challengeStranger(bot) {
  const player = bot.nearestEntity(entity => entity.type === 'player');
  if (!player) {
    return;
  }
  await moveTo(player.position.x, player.position.y, player.position.z, 2, 10);
  await bot.lookAt(player.position.offset(0, 1.6, 0));
}