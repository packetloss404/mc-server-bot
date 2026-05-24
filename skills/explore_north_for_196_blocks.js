async function explore_north_for_196_blocks(bot) {
  const startX = bot.entity.position.x;
  const startY = bot.entity.position.y;
  const startZ = bot.entity.position.z;
  const targetZ = startZ - 196;
  await moveTo(startX, startY, targetZ, 2, 30);
}