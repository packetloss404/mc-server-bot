async function explore_west_for_74_blocks(bot) {
  const targetX = bot.entity.position.x - 74;
  const targetY = bot.entity.position.y;
  const targetZ = bot.entity.position.z;
  await moveTo(targetX, targetY, targetZ, 2, 60);
}