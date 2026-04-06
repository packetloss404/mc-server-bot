async function exploreOneHundredBlocksNorth(bot) {
  const targetX = bot.entity.position.x;
  const targetY = bot.entity.position.y;
  const targetZ = bot.entity.position.z - 100;
  await moveTo(targetX, targetY, targetZ, 2, 300);
}