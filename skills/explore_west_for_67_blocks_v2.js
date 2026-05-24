async function explore_west_for_67_blocks(bot) {
  const targetX = bot.entity.position.x - 67;
  const targetZ = bot.entity.position.z;
  await moveTo(targetX, bot.entity.position.y, targetZ, 2, 30);
}