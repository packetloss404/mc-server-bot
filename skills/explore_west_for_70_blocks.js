async function explore_west_for_70_blocks(bot) {
  const targetX = bot.entity.position.x - 70;
  const targetY = bot.entity.position.y;
  const targetZ = bot.entity.position.z;
  await moveTo(targetX, targetY, targetZ, 2, 60);
}