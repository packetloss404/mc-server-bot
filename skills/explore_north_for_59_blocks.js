async function explore_north_for_59_blocks(bot) {
  const targetX = bot.entity.position.x;
  const targetY = bot.entity.position.y;
  const targetZ = bot.entity.position.z - 59;
  await moveTo(targetX, targetY, targetZ, 2, 30);
}