async function explore_south_for_62_blocks(bot) {
  const startX = bot.entity.position.x;
  const startY = bot.entity.position.y;
  const startZ = bot.entity.position.z;
  const targetZ = startZ - 62;
  await moveTo(startX, startY, targetZ, 2, 30);
}