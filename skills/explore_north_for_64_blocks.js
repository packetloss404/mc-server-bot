async function explore_north_for_64_blocks(bot) {
  const startX = bot.entity.position.x;
  const startY = bot.entity.position.y;
  const startZ = bot.entity.position.z;
  const targetX = startX;
  const targetY = startY;
  const targetZ = startZ - 64;
  await moveTo(targetX, targetY, targetZ, 2, 30);
}